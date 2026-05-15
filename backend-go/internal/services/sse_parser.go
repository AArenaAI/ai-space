package services

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
)

const (
	SSEReadBufferBytes = 64 * 1024        // 64KB 初始读取 buffer
	SSEMaxLineBytes    = 8 * 1024 * 1024  // 单行最大 8MB
	SSEMaxEventBytes   = 16 * 1024 * 1024 // 单个 SSE event 最大 16MB
)

// SSEEvent 表示一个解析后的 SSE 事件
type SSEEvent struct {
	Event string // 事件类型（默认 message）
	Data  []byte // 数据内容（多行 data: 用 \n 连接）
	ID    string // 事件 ID
	Retry string // retry 设置
}

// SSEParser 是一个基于 bufio.Reader 的 SSE 解析器，用于替代 bufio.Scanner
// 支持超长行（最大单行 8MB，单个事件 16MB），适合 GPT-5x Responses API 等超长事件行。
type SSEParser struct {
	reader        *bufio.Reader
	maxLineBytes  int
	maxEventBytes int
}

// NewSSEParser 创建一个 SSE 解析器
func NewSSEParser(r io.Reader) *SSEParser {
	return &SSEParser{
		reader:        bufio.NewReaderSize(r, SSEReadBufferBytes),
		maxLineBytes:  SSEMaxLineBytes,
		maxEventBytes: SSEMaxEventBytes,
	}
}

// Next 读取下一个 SSE 事件。返回 io.EOF 表示流结束。
func (p *SSEParser) Next() (*SSEEvent, error) {
	var eventName string
	var eventID string
	var retry string
	var data bytes.Buffer
	hasData := false

	for {
		line, err := p.readLine()
		if err != nil {
			if errors.Is(err, io.EOF) {
				if hasData || eventName != "" || eventID != "" {
					return &SSEEvent{
						Event: defaultEventName(eventName),
						Data:  data.Bytes(),
						ID:    eventID,
						Retry: retry,
					}, nil
				}
				return nil, io.EOF
			}
			return nil, err
		}

		line = bytes.TrimRight(line, "\r\n")

		// 空行表示一个 SSE event 结束
		if len(line) == 0 {
			if !hasData && eventName == "" && eventID == "" {
				continue
			}

			return &SSEEvent{
				Event: defaultEventName(eventName),
				Data:  data.Bytes(),
				ID:    eventID,
				Retry: retry,
			}, nil
		}

		// 注释行，忽略
		if line[0] == ':' {
			continue
		}

		field, value := splitSSEField(line)

		switch string(field) {
		case "event":
			eventName = string(value)

		case "data":
			if hasData {
				data.WriteByte('\n')
			}

			if data.Len()+len(value) > p.maxEventBytes {
				return nil, fmt.Errorf(
					"sse event too large: %d bytes, max %d bytes",
					data.Len()+len(value),
					p.maxEventBytes,
				)
			}

			data.Write(value)
			hasData = true

		case "id":
			eventID = string(value)

		case "retry":
			retry = string(value)

		default:
			// 未知字段忽略
		}
	}
}

// readLine 逐行读取，支持超长行。使用 ReadSlice 代替 Scanner。
func (p *SSEParser) readLine() ([]byte, error) {
	var line bytes.Buffer

	for {
		part, err := p.reader.ReadSlice('\n')

		if len(part) > 0 {
			if line.Len()+len(part) > p.maxLineBytes {
				return nil, fmt.Errorf(
					"sse line too large: %d bytes, max %d bytes",
					line.Len()+len(part),
					p.maxLineBytes,
				)
			}

			line.Write(part)
		}

		if err == nil {
			return line.Bytes(), nil
		}

		if errors.Is(err, bufio.ErrBufferFull) {
			// buffer 被填满但还没找到 \n，继续读
			continue
		}

		if errors.Is(err, io.EOF) && line.Len() > 0 {
			return line.Bytes(), nil
		}

		return nil, err
	}
}

// splitSSEField 将 SSE 行分割为字段和值
func splitSSEField(line []byte) ([]byte, []byte) {
	idx := bytes.IndexByte(line, ':')

	if idx < 0 {
		return line, nil
	}

	field := line[:idx]
	value := line[idx+1:]

	// SSE 规范里，冒号后面如果有一个空格，需要去掉
	if len(value) > 0 && value[0] == ' ' {
		value = value[1:]
	}

	return field, value
}

// defaultEventName 返回默认事件名
func defaultEventName(name string) string {
	if name == "" {
		return "message"
	}

	return name
}
