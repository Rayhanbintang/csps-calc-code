// devapi serves the Vercel functions locally for development:
//
//	SUPABASE_URL=... SUPABASE_SECRET_KEY=... go run ./cmd/devapi
//
// The Vite dev server proxies /api to it.
package main

import (
	"log"
	"net/http"

	handler "github.com/Rayhanbintang/csps-calc-code/api"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/estimates", handler.Estimates)
	mux.HandleFunc("/api/export", handler.Export)
	log.Println("api on :8787")
	log.Fatal(http.ListenAndServe("127.0.0.1:8787", mux))
}
