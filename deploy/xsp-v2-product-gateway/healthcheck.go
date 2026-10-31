package main

import (
	"io"
	"net/http"
	"os"
	"time"
)

func init() {
	if len(os.Args) != 2 || os.Args[1] != "--healthcheck" {
		return
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:8081/health")
	if err != nil {
		os.Exit(1)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		os.Exit(1)
	}
	os.Exit(0)
}
