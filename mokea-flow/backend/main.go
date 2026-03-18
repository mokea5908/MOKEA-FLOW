package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	server := &http.Server{
		Addr:    ":9600",
		Handler: mux,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		fmt.Println("[mokea-core] shutting down...")
		server.Shutdown(context.Background())
	}()

	fmt.Println("[mokea-core] server started on :9600")
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "[mokea-core] error: %v\n", err)
		os.Exit(1)
	}
}
