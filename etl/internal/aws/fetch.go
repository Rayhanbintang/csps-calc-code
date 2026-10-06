package aws

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"sort"

	"github.com/Rayhanbintang/csps-calc-code/etl/internal/httpx"
)

const host = "https://pricing.us-east-1.amazonaws.com"

// Region is one AWS region as listed in the manifest.
type Region struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	Prefix string `json:"prefix"`
}

// commercial matches public commercial regions ("ap-southeast-3"), not GovCloud,
// China, Local Zones ("us-west-2-lax-1") or Wavelength zones.
var commercial = regexp.MustCompile(`^(us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-\d$`)

// Regions lists the commercial regions that have EC2 prices.
func Regions(ctx context.Context) ([]string, error) {
	var idx struct {
		Regions map[string]any `json:"regions"`
	}
	err := httpx.Stream(ctx, host+"/offers/v1.0/aws/AmazonEC2/current/region_index.json", nil, func(r io.Reader) error {
		return json.NewDecoder(r).Decode(&idx)
	})
	if err != nil {
		return nil, err
	}
	var out []string
	for code := range idx.Regions {
		if commercial.MatchString(code) {
			out = append(out, code)
		}
	}
	sort.Strings(out)
	return out, nil
}

// Write stores one output file; path is relative to the provider folder.
type Write func(path string, v any) error

func offerURL(code, region string) string {
	return fmt.Sprintf("%s/offers/v1.0/aws/%s/current/%s/index.json", host, code, region)
}

// FetchRegion fetches every calculator service for one region and writes
// <region>/<service>.json. A service with no offer in the region is skipped.
func FetchRegion(ctx context.Context, region string, write Write) (*Region, error) {
	var ec2 *EC2Result
	err := httpx.Stream(ctx, offerURL("AmazonEC2", region), nil, func(r io.Reader) (err error) {
		ec2, err = ParseEC2(r)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("ec2: %w", err)
	}
	if len(ec2.Instances) == 0 {
		return nil, fmt.Errorf("ec2: no instances parsed")
	}

	spIndex, err := savingsPlanURL(ctx, region)
	if err != nil {
		return nil, err
	}
	var usageSP []UsageSP
	if spIndex != "" {
		err = httpx.Stream(ctx, host+spIndex, nil, func(r io.Reader) (err error) {
			for i := range ec2.Instances {
				ec2.Instances[i].SP = nil // a retried stream starts clean
			}
			usageSP, err = AttachSavingsPlans(r, ec2.Instances, ec2.Prefix)
			return err
		})
		if err != nil {
			return nil, fmt.Errorf("savings plans: %w", err)
		}
	}
	// Compute Savings Plan rates for Fargate and Lambda, by usage type.
	if err := write(region+"/sp.json", usageSP); err != nil {
		return nil, err
	}

	if err := write(region+"/ec2.json", ec2.Instances); err != nil {
		return nil, err
	}
	if err := write(region+"/ec2x.json", ec2.Rows); err != nil {
		return nil, err
	}

	for _, s := range Regional {
		var rows []Row
		err := httpx.Stream(ctx, offerURL(s.Code, region), nil, func(r io.Reader) (err error) {
			rows, err = ParseRows(r, s, ec2.Prefix)
			return err
		})
		if se, ok := err.(httpx.StatusError); ok && (se.Code == 403 || se.Code == 404) {
			continue // the service is not offered in this region
		}
		if err != nil {
			return nil, fmt.Errorf("%s: %w", s.Code, err)
		}
		if err := write(region+"/"+s.File+".json", rows); err != nil {
			return nil, err
		}
	}
	return &Region{Code: region, Name: ec2.Location, Prefix: ec2.Prefix}, nil
}

// FetchGlobal fetches the services priced once for all regions (Route 53 zones,
// the Shield Advanced subscription) into global/<service>.json.
func FetchGlobal(ctx context.Context, write Write) error {
	for _, s := range Global {
		var rows []Row
		err := httpx.Stream(ctx, offerURL(s.Code, "aws-other"), nil, func(r io.Reader) (err error) {
			rows, err = ParseRows(r, s, "")
			return err
		})
		if err != nil {
			return fmt.Errorf("%s: %w", s.Code, err)
		}
		if err := write("global/"+s.File+".json", rows); err != nil {
			return err
		}
	}
	return nil
}

func savingsPlanURL(ctx context.Context, region string) (string, error) {
	var idx struct {
		Regions []struct {
			RegionCode string `json:"regionCode"`
			VersionURL string `json:"versionUrl"`
		} `json:"regions"`
	}
	err := httpx.Stream(ctx, host+"/savingsPlan/v1.0/aws/AWSComputeSavingsPlan/current/region_index.json", nil,
		func(r io.Reader) error { return json.NewDecoder(r).Decode(&idx) })
	if err != nil {
		return "", fmt.Errorf("savings plan index: %w", err)
	}
	for _, r := range idx.Regions {
		if r.RegionCode == region {
			return r.VersionURL, nil
		}
	}
	return "", nil
}
