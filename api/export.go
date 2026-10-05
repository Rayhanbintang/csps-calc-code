// Vercel function: POST /api/export?format=xlsx|pdf turns a report into a file.
package handler

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/Rayhanbintang/csps-calc-code/apilib/pdf"
	"github.com/Rayhanbintang/csps-calc-code/apilib/report"
	"github.com/Rayhanbintang/csps-calc-code/apilib/xlsx"
)

const maxReport = 400 << 10

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// Export builds the file in memory and returns it as a download.
func Export(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		jsonError(w, http.StatusMethodNotAllowed, "Use POST.")
		return
	}
	format := r.URL.Query().Get("format")
	if format != "xlsx" && format != "pdf" {
		jsonError(w, http.StatusBadRequest, "Ask for format=xlsx or format=pdf.")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxReport+1))
	if err != nil || len(raw) > maxReport {
		jsonError(w, http.StatusRequestEntityTooLarge, "The estimate is too large to export.")
		return
	}
	var rep report.Report
	if err := json.Unmarshal(raw, &rep); err != nil {
		jsonError(w, http.StatusBadRequest, "The estimate could not be read.")
		return
	}
	if err := rep.Validate(); err != nil {
		jsonError(w, http.StatusBadRequest, "The estimate is not valid: "+err.Error()+".")
		return
	}

	var out []byte
	ctype := "application/pdf"
	if format == "xlsx" {
		out, err = xlsx.Build(&rep)
		ctype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	} else {
		out, err = pdf.Build(&rep)
	}
	if err != nil {
		log.Printf("export %s: %v", format, err)
		jsonError(w, http.StatusInternalServerError, "The file could not be built.")
		return
	}
	name := strings.Trim(unsafeName.ReplaceAllString(rep.Name, "-"), "-")
	if name == "" {
		name = "estimate"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+"."+format+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Write(out)
}

func jsonError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
