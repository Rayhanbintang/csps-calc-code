// spike-ec2 measures how small one region's EC2 price data gets after slimming (plan T5.2).
//
//	go run ./cmd/spike-ec2 ap-southeast-3 us-east-1
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/Rayhanbintang/csps-calc-code/etl/internal/aws"
)

const base = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/%s/index.json"

func main() {
	for _, region := range os.Args[1:] {
		start := time.Now()
		resp, err := http.Get(fmt.Sprintf(base, region))
		if err != nil {
			fail(err)
		}
		insts, err := aws.ParseEC2(resp.Body)
		resp.Body.Close()
		if err != nil {
			fail(fmt.Errorf("%s: %w", region, err))
		}

		raw, _ := json.Marshal(insts)
		var gz bytes.Buffer
		w, _ := gzip.NewWriterLevel(&gz, gzip.BestCompression)
		w.Write(raw)
		w.Close()

		types := map[string]bool{}
		for _, i := range insts {
			types[i.Type] = true
		}
		fmt.Printf("%-16s source %6.1f MB | rows %6d | types %4d | json %6.2f MB | gzip %5.2f MB | %s\n",
			region, float64(resp.ContentLength)/1e6, len(insts), len(types),
			float64(len(raw))/1e6, float64(gz.Len())/1e6, time.Since(start).Round(time.Second))

		os.MkdirAll("out", 0o755)
		os.WriteFile("out/ec2-"+region+".json", raw, 0o644)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
