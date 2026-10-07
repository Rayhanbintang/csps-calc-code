package aws

import (
	"io"
	"regexp"
	"strings"
)

// Service describes one AWS offer and how to slim it into a price file.
type Service struct {
	Code  string   // offer code in the Price List API, e.g. "AWSELB"
	File  string   // output file name without extension, e.g. "elb"
	Attrs []string // attributes kept on each row
	// Keep decides whether a product is priced by the calculator. nil keeps every row.
	Keep func(family string, a map[string]string) bool
}

// twoRegions matches usage types that name a pair of regions, e.g. cross-region
// replication "AFS1-APS4-S3RTC-Out-Bytes". The calculator prices those through
// data transfer, so the per-service copies are dropped.
var twoRegions = regexp.MustCompile(`^[A-Z]{2,4}\d?-[A-Z]{2,4}\d?-`)

// plainNode matches "APS4-NodeUsage:cache.m5.large" and "NodeUsage:cache.m5.large" but
// not add-ons such as "APS4-ExtendedSupportYr3-NodeUsage:...".
var plainNode = regexp.MustCompile(`^([A-Z]{2,4}\d?-)?NodeUsage:`)

// Regional services, fetched once per region.
var Regional = []Service{
	{Code: "AmazonRDS", File: "rds",
		// deploymentModel is "Custom" on RDS Custom rows, which otherwise look like plain
		// RDS rows (same engine, edition, licence and deployment option).
		Attrs: []string{"instanceType", "databaseEngine", "databaseEdition", "licenseModel", "deploymentOption", "deploymentModel", "vcpu", "memory", "volumeType"},
		Keep: func(f string, a map[string]string) bool {
			if strings.Contains(a["databaseEngine"], "Outposts") {
				return false
			}
			switch f {
			case "Database Instance":
				d := a["deploymentOption"]
				return d == "Single-AZ" || d == "Multi-AZ"
			case "Database Storage", "Provisioned IOPS", "Provisioned Throughput":
				return true
			case "System Operation":
				return strings.HasSuffix(a["usagetype"], "Aurora:StorageIOUsage") // Aurora Standard I/O requests
			case "Storage Snapshot":
				// Backup storage past the free allowance: one RDS row and the Aurora rows.
				e := a["databaseEngine"]
				return e == "Any" || strings.HasPrefix(e, "Aurora")
			}
			return false
		}},
	{Code: "AmazonElastiCache", File: "elasticache",
		Attrs: []string{"instanceType", "cacheEngine", "vcpu", "memory"},
		Keep: func(f string, a map[string]string) bool {
			// Drop extended-support, Outposts and durability add-on rows: only the plain
			// node price and serverless rows are priced.
			u := a["usagetype"]
			return (f == "Cache Instance" && plainNode.MatchString(u)) ||
				(strings.Contains(f, "Serverless") && !strings.Contains(u, "Outpost"))
		}},
	{Code: "AmazonS3", File: "s3", Attrs: []string{"storageClass", "volumeType"},
		Keep: func(f string, a map[string]string) bool { return !twoRegions.MatchString(a["usagetype"]) }},
	{Code: "AmazonEFS", File: "efs"},
	{Code: "AWSLambda", File: "lambda"},
	{Code: "AmazonECS", File: "fargate", Keep: func(f string, a map[string]string) bool {
		return strings.Contains(a["usagetype"], "Fargate")
	}},
	{Code: "AmazonEKS", File: "eks", Keep: func(f string, a map[string]string) bool {
		return !strings.Contains(a["usagetype"], "EKS-Auto") && !strings.Contains(a["usagetype"], "EKSCapabilities")
	}},
	{Code: "AWSELB", File: "elb"},
	{Code: "AmazonVPC", File: "vpc"},
	{Code: "AmazonApiGateway", File: "apigw"},
	{Code: "awswaf", File: "waf"},
	{Code: "AWSShield", File: "shield"},
	{Code: "AWSDataTransfer", File: "transfer"},
	{Code: "AWSDirectConnect", File: "dx", Attrs: []string{"capacity", "connectionType", "fromLocation", "toLocation", "location"},
		Keep: func(f string, a map[string]string) bool {
			// Port hours, and transfer out from the region (one row per DX location).
			u := a["usagetype"]
			return strings.Contains(u, "PortUsage:") && !strings.Contains(u, "FlatRate") ||
				f == "Data Transfer" && strings.HasSuffix(u, "-DataXfer-Out")
		}},
	{Code: "AmazonSNS", File: "sns"},
	{Code: "AWSQueueService", File: "sqs"},
	{Code: "AmazonCloudWatch", File: "cloudwatch"},
	{Code: "AWSBackup", File: "backup", Keep: func(f string, a map[string]string) bool {
		// Storage in the region's own vault; copies to other regions, logically
		// air-gapped vaults and search are left out.
		u := a["usagetype"]
		return strings.Contains(u, "Storage-") && !strings.Contains(u, "CrossRegion") && !strings.HasSuffix(u, "-LAGV")
	}},
}

// Global services live in the "aws-other" region of the Price List API.
var Global = []Service{
	{Code: "AWSShield", File: "shield"},
	{Code: "AmazonRoute53", File: "route53"},
	// CloudFront prices by where viewers are (US, EU, AP, ...), not by AWS region.
	{Code: "AmazonCloudFront", File: "cloudfront", Keep: func(f string, a map[string]string) bool {
		return f == "Data Transfer" || f == "Request"
	}},
}

// ParseRows streams an offer file and returns the kept products as price rows.
func ParseRows(r io.Reader, s Service, prefix string) ([]Row, error) {
	keep := s.Keep
	if keep == nil {
		keep = func(string, map[string]string) bool { return true }
	}
	items, err := parseOffer(r, keep)
	if err != nil {
		return nil, err
	}
	rows := make([]Row, 0, len(items))
	for _, it := range items {
		if !it.hasOnDem {
			continue
		}
		rows = append(rows, toRow(it, prefix, s.Attrs))
	}
	sortRows(rows)
	return rows, nil
}
