package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// AIChunk is sent with the text an AI writing request streams, and once
// more when it ends.
var AIChunk = mygo.NewEvent[AIChunkEvent]("aiChunk")

// AIChunkEvent is a piece of an AI writing request's answer.
type AIChunkEvent struct {
	ID    string `json:"id"`
	Text  string `json:"text,omitempty"`
	Done  bool   `json:"done,omitempty"`
	Error string `json:"error,omitempty"`
}

// AISettings are the AI writing service's: an OpenAI compatible API, as
// the user's new-api gateway.
type AISettings struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
}

// AIRequest asks the AI to write: continue, polish, expand, shorten,
// summarize, translate_en, translate_zh, fix, or custom with an
// instruction.
type AIRequest struct {
	Action      string `json:"action"`
	Text        string `json:"text"`
	Instruction string `json:"instruction,omitempty"`
	Title       string `json:"title,omitempty"` // the note's, as context
}

// AI writes with the AI service of the settings, as the notes' editor
// asks, the way the user's Outline does.
type AI struct {
	mu       sync.Mutex
	cancels  map[string]context.CancelFunc
	settings *Settings
}

const aiSystemPrompt = "You are a writing assistant embedded in a notes editor. " +
	"Reply with the resulting text only, formatted as Markdown, without any preface, explanation or code fence around the whole answer. " +
	"Keep the language of the source text unless the task asks for a translation. " +
	"Preserve facts, names, links, code and numbers exactly."

var aiTasks = map[string]string{
	"continue":     "Continue writing after the given text in the same style and language. Return only the new continuation, do not repeat the given text.",
	"polish":       "Polish the given text: improve clarity, flow and wording while keeping its meaning and structure.",
	"expand":       "Expand the given text with more detail, examples and explanation while keeping its meaning.",
	"shorten":      "Make the given text more concise while keeping all key information.",
	"summarize":    "Summarize the given text as a short list of key points.",
	"translate_en": "Translate the given text into English.",
	"translate_zh": "Translate the given text into Simplified Chinese.",
	"fix":          "Fix spelling, grammar and punctuation mistakes in the given text without changing its meaning or style.",
}

// Write starts a request and returns its ID; AIChunk brings the answer.
func (a *AI) Write(req AIRequest) (string, error) {
	cfg := a.settings.current().AI
	if strings.TrimSpace(cfg.BaseURL) == "" || strings.TrimSpace(cfg.Model) == "" {
		return "", errors.New("还没有配置 AI：在「设置 → AI 写作」里填接口地址、密钥和模型")
	}
	task := aiTasks[req.Action]
	if req.Action == "custom" {
		if strings.TrimSpace(req.Instruction) == "" {
			return "", errors.New("请写下要 AI 做什么")
		}
		task = "Follow this instruction: " + req.Instruction
	} else if task == "" {
		return "", errors.New("不支持的 AI 操作：" + req.Action)
	}
	about := ""
	if req.Title != "" {
		about = "Note title: " + req.Title + "\n\n"
	}
	messages := []map[string]string{
		{"role": "system", "content": aiSystemPrompt},
		{"role": "user", "content": task + "\n\n" + about + "Text:\n\"\"\"\n" + req.Text + "\n\"\"\""},
	}
	id := newID()
	// Slow models take a minute to start; the user can cancel.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	a.mu.Lock()
	if a.cancels == nil {
		a.cancels = map[string]context.CancelFunc{}
	}
	a.cancels[id] = cancel
	a.mu.Unlock()
	go func() {
		defer func() {
			cancel()
			a.mu.Lock()
			delete(a.cancels, id)
			a.mu.Unlock()
		}()
		err := chat(ctx, cfg, messages, func(text string) {
			AIChunk.Broadcast(AIChunkEvent{ID: id, Text: text})
		})
		end := AIChunkEvent{ID: id, Done: true}
		if err != nil && !errors.Is(err, context.Canceled) {
			end.Error = err.Error()
		}
		AIChunk.Broadcast(end)
	}()
	return id, nil
}

// Cancel stops a request.
func (a *AI) Cancel(id string) {
	a.mu.Lock()
	cancel := a.cancels[id]
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// Models lists the models of a service, which need not be saved yet.
func (a *AI) Models(cfg AISettings) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := aiRequest(ctx, cfg, http.MethodGet, "/models", nil)
	if err != nil {
		return nil, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err := apiError(res, b); err != nil {
		return nil, err
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(b, &body); err != nil {
		return nil, notAPI(b)
	}
	var models []string
	for _, m := range body.Data {
		models = append(models, m.ID)
	}
	slices.Sort(models)
	return models, nil
}

// Test asks a service, which need not be saved yet, for a word, and
// returns its answer.
func (a *AI) Test(cfg AISettings) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	var out strings.Builder
	err := chat(ctx, cfg, []map[string]string{{"role": "user", "content": "回复「连接正常」四个字。"}}, func(s string) { out.WriteString(s) })
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(out.String()) == "" {
		return "", errors.New("接口没有返回内容")
	}
	return out.String(), nil
}

// chat streams a chat completion, calling onText with each piece.
func chat(ctx context.Context, cfg AISettings, messages []map[string]string, onText func(string)) error {
	if strings.TrimSpace(cfg.Model) == "" {
		return errors.New("还没有选择模型")
	}
	payload, _ := json.Marshal(map[string]any{"model": cfg.Model, "messages": messages, "stream": true})
	req, err := aiRequest(ctx, cfg, http.MethodPost, "/chat/completions", payload)
	if err != nil {
		return err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("连不上 AI 接口：%w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		return apiError(res, b)
	}
	if !strings.Contains(res.Header.Get("Content-Type"), "event-stream") {
		// A service that does not stream answers at once.
		b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
		var body struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(b, &body); err != nil || len(body.Choices) == 0 {
			return notAPI(b)
		}
		onText(body.Choices[0].Message.Content)
		return nil
	}
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	got := false
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		data, ok := strings.CutPrefix(line, "data:")
		if !ok {
			continue
		}
		data = strings.TrimSpace(data)
		if data == "[DONE]" {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		if chunk.Error != nil {
			return errors.New(chunk.Error.Message)
		}
		for _, c := range chunk.Choices {
			if c.Delta.Content != "" {
				got = true
				onText(c.Delta.Content)
			}
		}
	}
	if err := sc.Err(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return err
	}
	if !got {
		return errors.New("AI 没有返回内容")
	}
	return nil
}

// aiRequest makes a request to the service; a base URL without a path gets
// /v1, as OpenAI compatible services serve there.
func aiRequest(ctx context.Context, cfg AISettings, method, path string, body []byte) (*http.Request, error) {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	u, err := url.Parse(base)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, errors.New("接口地址不对，应该像 https://api.example.com/v1")
	}
	if u.Path == "" {
		base += "/v1"
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if key := strings.TrimSpace(cfg.APIKey); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	return req, nil
}

// apiError reads the error of a failed response.
func apiError(res *http.Response, b []byte) error {
	if res.StatusCode == http.StatusOK {
		return nil
	}
	var body struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	json.Unmarshal(b, &body)
	msg := body.Error.Message
	if msg == "" {
		msg = body.Message
	}
	if msg == "" {
		msg = strings.TrimSpace(string(b[:min(len(b), 200)]))
	}
	return fmt.Errorf("AI 接口出错（%d）：%s", res.StatusCode, msg)
}

// notAPI explains an answer that is not the API's, as a web page that a
// base URL without /v1 may give.
func notAPI(b []byte) error {
	if bytes.Contains(bytes.ToLower(b[:min(len(b), 512)]), []byte("<html")) {
		return errors.New("返回的是网页而不是 AI 接口的数据，检查接口地址（通常以 /v1 结尾）")
	}
	return fmt.Errorf("看不懂接口返回的数据：%s", strings.TrimSpace(string(b[:min(len(b), 200)])))
}
