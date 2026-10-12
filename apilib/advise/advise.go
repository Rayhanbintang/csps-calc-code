// Package advise asks a language model on Groq to review an estimate. The model reads
// a short text summary of the board and answers in plain text; it never changes the
// estimate. Groq's free plan has tight token limits, so the summary stays small.
package advise

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Rayhanbintang/csps-calc-code/apilib/report"
)

// Model is the Groq model the reviewer uses.
const Model = "openai/gpt-oss-120b"

// MaxSummary caps the estimate text sent to the model (about 3,000 tokens).
const MaxSummary = 12000

const endpoint = "https://api.groq.com/openai/v1/chat/completions"

var client = &http.Client{Timeout: 25 * time.Second}

// ErrBusy means Groq's free plan limit was hit for the moment.
var ErrBusy = errors.New("busy")

// Turn is one earlier question or answer in the conversation.
type Turn struct {
	Role    string `json:"role"` // "user" or "assistant"
	Content string `json:"content"`
}

// System tells the model what it is for. It reviews; it does not edit or invent prices.
const System = `You review cloud cost estimates made in csps-calc, a calculator that prices one design on AWS, Google Cloud, Oracle Cloud (OCI) and Microsoft Azure with public list prices in USD, before tax.

You get the estimate as text: sites (one cloud account each), region boxes, and cards with their count, product, pricing model and monthly price. Indented cards sit inside the card above them.

Give advice only. You cannot change the estimate; tell the reader what to change.
If a question is not about this estimate or cloud costs, say in one sentence that you answer questions about this estimate, and suggest one.
- Point out risks: missing pieces (backups, monitoring, data transfer between sites, a VPN or interconnect, high availability), single points of failure, odd counts or sizes.
- Point out savings: commitments (Savings Plans, Reserved Instances, committed use), smaller or newer machine types, storage classes, a cheaper region or cloud, judged from the prices shown.
- Name the cards you mean, by their names in the estimate.
- Use only the prices in the estimate. Never state a price, a discount or a percentage that is not in the estimate; when a saving depends on a price you do not have, say "check the price list".
- Each card lists the lines its price covers. Read them before saying something is missing (high availability, capacity units, storage).
- Do not compare regions or clouds on price unless the estimate itself prices both.
- Free-tier allowances are not taken off the totals; mention them only when they matter.
- For a full review, use two headings (Risks, Savings) with at most four bullet points each. For any other question, answer it directly in a few sentences or bullets. Plain language, no tables. Answer in the language of the question.
- Before you answer, check each claim against the estimate text. Leave out any claim you cannot point to in it.`

// Summary turns a report into compact text for the model.
func Summary(r *report.Report) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Estimate: %s\nPrices as of %s\nTotal: $%.2f a month, $%.2f upfront, $%.2f in the first 12 months\n", r.Name, r.PricesAsOf, r.Monthly, r.Upfront, r.FirstYear)
	for _, a := range r.Accounts {
		fmt.Fprintf(&b, "\nSite: %s (%s), $%.2f a month", a.Label, a.ProviderName, a.Monthly)
		if a.Support != nil {
			fmt.Fprintf(&b, ", support plan %s $%.2f", a.Support.Plan, a.Support.Monthly)
		}
		b.WriteString("\n")
		for _, x := range a.Boxes {
			label := x.RegionName
			if x.Label != "" {
				label += " · " + x.Label
			}
			fmt.Fprintf(&b, "  Region box %s: $%.2f a month\n", label, x.Monthly)
			for _, it := range x.Items {
				indent := strings.Repeat("  ", it.Depth+2)
				price := fmt.Sprintf("$%.2f/month", it.Monthly)
				if it.Upfront > 0 {
					price += fmt.Sprintf(" + $%.2f upfront", it.Upfront)
				}
				if it.Unavailable != "" {
					price = "not priced: " + it.Unavailable
				}
				fmt.Fprintf(&b, "%s- %s: %g × %s (%s), %s, %s\n", indent, it.Name, it.Qty, it.Service, it.SKU, it.Pricing, price)
				// The priced lines say what the price covers (Multi-AZ, capacity units, storage).
				for i, l := range it.Lines {
					if i == 4 {
						break
					}
					fmt.Fprintf(&b, "%s    · %s: %g %s, $%.2f/month\n", indent, l.Label, l.Qty, l.Unit, l.Monthly)
				}
				if b.Len() > MaxSummary {
					b.WriteString("(the rest of the estimate is cut to keep the request small)\n")
					return b.String()
				}
			}
		}
	}
	return b.String()
}

// Ask sends the summary, earlier turns and the question to Groq and returns the answer.
func Ask(ctx context.Context, key, summary string, history []Turn, question string) (string, error) {
	msgs := []Turn{{Role: "system", Content: System}, {Role: "user", Content: "The estimate:\n\n" + summary}}
	msgs = append(msgs, history...)
	if strings.TrimSpace(question) == "" {
		question = "Review this estimate: the main risks, then the main savings."
	}
	msgs = append(msgs, Turn{Role: "user", Content: question})
	body, _ := json.Marshal(map[string]any{
		"model": Model, "messages": msgs, "temperature": 0.2, "max_completion_tokens": 2400,
		// gpt-oss reasons before it answers. Low effort made careless claims (invented rates,
		// misread lines); medium checks its work, and the cap leaves room for both.
		"reasoning_effort": "medium",
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusTooManyRequests {
		return "", ErrBusy
	}
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("groq: HTTP %d", resp.StatusCode)
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || len(out.Choices) == 0 {
		return "", errors.New("groq: no answer in the reply")
	}
	return strings.TrimSpace(out.Choices[0].Message.Content), nil
}
