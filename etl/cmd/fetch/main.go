// fetch downloads public cloud prices and writes the slim JSON files the web app reads.
//
//	go run ./cmd/fetch -out ../web/public/prices -providers aws,gcp,oci
//
// Output: <out>/manifest.json plus <out>/<provider>/... price files. When a provider or
// region fails after retries, its files are copied from the live site (-fallback) so a
// broken fetch never ships an empty price list; the manifest keeps the older date.
package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Rayhanbintang/csps-calc-code/etl/internal/aws"
	"github.com/Rayhanbintang/csps-calc-code/etl/internal/azure"
	"github.com/Rayhanbintang/csps-calc-code/etl/internal/gcp"
	"github.com/Rayhanbintang/csps-calc-code/etl/internal/oci"
)

// Manifest lists what was fetched and when. The web app loads it first.
type Manifest struct {
	Generated string               `json:"generated"`
	Providers map[string]*Provider `json:"providers"`
}

// Provider is one provider's entry in the manifest.
type Provider struct {
	Regions []RegionEntry `json:"regions"`
}

// RegionEntry is one region with the time its prices were fetched.
type RegionEntry struct {
	Code    string `json:"code"`
	Name    string `json:"name"`
	Prefix  string `json:"prefix,omitempty"`
	Fetched string `json:"fetched"`
	Stale   bool   `json:"stale,omitempty"` // copied from the previous deploy
}

func main() {
	out := flag.String("out", "out/prices", "output folder")
	providers := flag.String("providers", "aws,gcp,oci,azure", "providers to fetch")
	regions := flag.String("regions", "", "comma-separated AWS regions (default: all)")
	parallel := flag.Int("parallel", 4, "AWS regions fetched at once")
	fallback := flag.String("fallback", "", "base URL of the live site, used when a fetch fails")
	mirror := flag.String("mirror", "", "copy every price file from this live site instead of fetching (for code-only deploys)")
	flag.Parse()

	if *mirror != "" {
		if err := mirrorLive(*mirror, *out); err != nil {
			log.Fatalf("mirror: %v", err)
		}
		return
	}

	ctx := context.Background()
	now := time.Now().UTC().Format(time.RFC3339)
	m := &Manifest{Generated: now, Providers: map[string]*Provider{}}
	prev := loadPrevManifest(*fallback)

	failed := false
	for _, p := range strings.Split(*providers, ",") {
		var err error
		switch strings.TrimSpace(p) {
		case "aws":
			err = fetchAWS(ctx, *out, *regions, *parallel, *fallback, now, prev, m)
		case "gcp":
			err = fetchSimple(ctx, *out, "gcp", now, *fallback, prev, m, gcp.Fetch)
		case "oci":
			err = fetchSimple(ctx, *out, "oci", now, *fallback, prev, m, oci.Fetch)
		case "azure":
			err = fetchSimple(ctx, *out, "azure", now, *fallback, prev, m, azure.Fetch)
		default:
			err = fmt.Errorf("unknown provider %q", p)
		}
		if err != nil {
			log.Printf("%s: %v", p, err)
			failed = true
		}
	}
	if err := writeJSON(filepath.Join(*out, "manifest.json"), m); err != nil {
		log.Fatal(err)
	}
	if failed {
		os.Exit(1)
	}
}

// writer stores price files gzipped ("x.json" is written as "x.json.gz"). Vercel Hobby
// allows 100 MB of static files per deploy; plain JSON for every AWS region would not
// fit. The browser unpacks the files with DecompressionStream.
func writer(dir string) func(string, any) error {
	return func(path string, v any) error {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		dst := filepath.Join(dir, path) + ".gz"
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		zw.Write(b)
		if err := zw.Close(); err != nil {
			return err
		}
		return os.WriteFile(dst, buf.Bytes(), 0o644)
	}
}

func writeJSON(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func fetchAWS(ctx context.Context, out, only string, parallel int, fallback, now string, prev *Manifest, m *Manifest) error {
	dir := filepath.Join(out, "aws")
	write := writer(dir)
	codes, err := aws.Regions(ctx)
	if err != nil {
		return err
	}
	if only != "" {
		codes = strings.Split(only, ",")
	}

	p := &Provider{}
	m.Providers["aws"] = p
	var mu sync.Mutex
	var errs []string
	sem := make(chan struct{}, parallel)
	var wg sync.WaitGroup
	for _, code := range codes {
		wg.Add(1)
		go func(code string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			start := time.Now()
			r, err := aws.FetchRegion(ctx, code, write)
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				log.Printf("aws %s ok in %s", code, time.Since(start).Round(time.Second))
				p.Regions = append(p.Regions, RegionEntry{Code: r.Code, Name: r.Name, Prefix: r.Prefix, Fetched: now})
				return
			}
			log.Printf("aws %s failed: %v", code, err)
			if e, ok := restoreRegion(fallback, prev, "aws", code, dir); ok {
				p.Regions = append(p.Regions, e)
				return
			}
			errs = append(errs, code)
		}(code)
	}
	wg.Wait()

	if err := aws.FetchGlobal(ctx, write); err != nil {
		log.Printf("aws global failed: %v", err)
		if !copyFromLive(fallback, "aws", "global", dir, []string{"shield.json", "route53.json"}) {
			errs = append(errs, "global")
		}
	}
	sort.Slice(p.Regions, func(i, j int) bool { return p.Regions[i].Code < p.Regions[j].Code })
	if len(errs) > 0 {
		return fmt.Errorf("no prices and no fallback for: %s", strings.Join(errs, ", "))
	}
	return nil
}

// fetchSimple runs a provider whose fetch returns its own region list (GCP, OCI, Azure).
func fetchSimple(ctx context.Context, out, name, now, fallback string, prev *Manifest, m *Manifest,
	fetch func(context.Context, func(string, any) error) ([][2]string, []string, error)) error {
	dir := filepath.Join(out, name)
	regions, files, err := fetch(ctx, writer(dir))
	if err == nil {
		p := &Provider{}
		for _, r := range regions {
			p.Regions = append(p.Regions, RegionEntry{Code: r[0], Name: r[1], Fetched: now})
		}
		m.Providers[name] = p
		return nil
	}
	log.Printf("%s failed: %v", name, err)
	if prev == nil || prev.Providers[name] == nil {
		return err
	}
	if !copyFromLive(fallback, name, "", dir, files) {
		return err
	}
	p := prev.Providers[name]
	for i := range p.Regions {
		p.Regions[i].Stale = true
	}
	m.Providers[name] = p
	return nil
}

func loadPrevManifest(base string) *Manifest {
	if base == "" {
		return nil
	}
	var m Manifest
	if err := getJSON(base+"/prices/manifest.json", &m); err != nil {
		log.Printf("no previous manifest: %v", err)
		return nil
	}
	return &m
}

func restoreRegion(base string, prev *Manifest, provider, code, dir string) (RegionEntry, bool) {
	if prev == nil || prev.Providers[provider] == nil {
		return RegionEntry{}, false
	}
	for _, e := range prev.Providers[provider].Regions {
		if e.Code != code {
			continue
		}
		files := []string{"ec2.json", "ec2x.json"}
		for _, s := range aws.Regional {
			files = append(files, s.File+".json")
		}
		copyFromLive(base, provider, code, dir, files) // missing service files are fine
		if _, err := os.Stat(filepath.Join(dir, code, "ec2.json.gz")); err != nil {
			return RegionEntry{}, false
		}
		e.Stale = true
		return e, true
	}
	return RegionEntry{}, false
}

// copyFromLive downloads files of the previous deploy. It reports whether any arrived.
func copyFromLive(base, provider, sub, dir string, files []string) bool {
	if base == "" {
		return false
	}
	any := false
	for _, f := range files {
		f += ".gz"
		rel := filepath.ToSlash(filepath.Join(sub, f))
		resp, err := http.Get(base + "/prices/" + provider + "/" + rel)
		if err != nil {
			continue
		}
		if resp.StatusCode == 200 {
			dst := filepath.Join(dir, sub, f)
			os.MkdirAll(filepath.Dir(dst), 0o755)
			if fh, err := os.Create(dst); err == nil {
				io.Copy(fh, resp.Body)
				fh.Close()
				any = true
			}
		}
		resp.Body.Close()
	}
	return any
}

func getJSON(url string, v any) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

// mirrorLive copies the manifest and every price file of the live site, so a deploy that
// only changes code ships yesterday's prices without a long fetch.
func mirrorLive(base, out string) error {
	var m Manifest
	if err := getJSON(base+"/prices/manifest.json", &m); err != nil {
		return err
	}
	if len(m.Providers) == 0 {
		return fmt.Errorf("live manifest is empty")
	}
	files := map[string][]string{}
	if p := m.Providers["aws"]; p != nil {
		names := []string{"ec2.json", "ec2x.json", "sp.json"}
		for _, s := range aws.Regional {
			names = append(names, s.File+".json")
		}
		for _, r := range p.Regions {
			for _, n := range names {
				files["aws"] = append(files["aws"], r.Code+"/"+n)
			}
		}
		for _, s := range aws.Global {
			files["aws"] = append(files["aws"], "global/"+s.File+".json")
		}
	}
	if p := m.Providers["gcp"]; p != nil {
		files["gcp"] = append(files["gcp"], "global.json")
		for _, r := range p.Regions {
			files["gcp"] = append(files["gcp"], r.Code+".json")
		}
	}
	if m.Providers["oci"] != nil {
		files["oci"] = []string{"prices.json"}
	}
	if p := m.Providers["azure"]; p != nil {
		files["azure"] = append(files["azure"], "global.json")
		for _, r := range p.Regions {
			files["azure"] = append(files["azure"], r.Code+".json")
		}
	}
	for provider, list := range files {
		dir := filepath.Join(out, provider)
		if !copyFromLive(base, provider, "", dir, list) {
			return fmt.Errorf("no %s files on the live site", provider)
		}
		// Each region must have its main file; service files may be absent in a region.
		for _, f := range list {
			if strings.HasSuffix(f, "/ec2.json") || provider != "aws" {
				if _, err := os.Stat(filepath.Join(dir, f) + ".gz"); err != nil {
					return fmt.Errorf("%s/%s missing on the live site", provider, f)
				}
			}
		}
	}
	return writeJSON(filepath.Join(out, "manifest.json"), m)
}
