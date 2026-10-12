// Vercel function: POST /api/export?format=xlsx|pdf turns a report into a file.
// format=awsec2 fills the visitor's own copy of AWS's EC2 bulk upload template.
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/Rayhanbintang/csps-calc-code/apilib/awsec2"
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
	if format == "awsec2" {
		fillAwsTemplate(w, r)
		return
	}
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

// maxTemplate caps the uploaded template; AWS's file is about 80 KB.
const maxTemplate = 2 << 20

// fillAwsTemplate reads a multipart form: "template" (the .xlsx) and "rows" (JSON).
// Nothing is stored; the filled file goes straight back.
func fillAwsTemplate(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxTemplate+maxReport)
	if err := r.ParseMultipartForm(maxTemplate + maxReport); err != nil {
		var big *http.MaxBytesError
		if errors.As(err, &big) {
			jsonError(w, http.StatusRequestEntityTooLarge, "The template or the estimate is too large.")
		} else {
			jsonError(w, http.StatusBadRequest, "Send the template as a file upload.")
		}
		return
	}
	file, _, err := r.FormFile("template")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Choose your copy of AWS's EC2 template.")
		return
	}
	defer file.Close()
	tpl, err := io.ReadAll(io.LimitReader(file, maxTemplate+1))
	if err != nil || len(tpl) > maxTemplate {
		jsonError(w, http.StatusRequestEntityTooLarge, "The template is too large.")
		return
	}
	var rows []awsec2.Row
	if err := json.Unmarshal([]byte(r.FormValue("rows")), &rows); err != nil {
		jsonError(w, http.StatusBadRequest, "The rows could not be read.")
		return
	}
	for _, row := range rows {
		for _, v := range []string{row.Group, row.Description, row.Region, row.OS, row.Type, row.Tenancy, row.UsageType, row.Purchase, row.Storage, row.SnapFreq} {
			if len(v) > report.MaxText {
				jsonError(w, http.StatusBadRequest, "A row has a value that is too long.")
				return
			}
		}
	}
	out, err := awsec2.Fill(tpl, rows)
	if err != nil {
		jsonError(w, http.StatusBadRequest, strings.ToUpper(err.Error()[:1])+err.Error()[1:]+".")
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="aws-ec2-template-filled.xlsx"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Write(out)
}

func jsonError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
