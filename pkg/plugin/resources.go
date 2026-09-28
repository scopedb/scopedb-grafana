package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
	scopedb "github.com/scopedb/goscopedb"
)

func (d *Datasource) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	return httpadapter.New(http.HandlerFunc(d.handleResource)).CallResource(ctx, req, sender)
}

func (d *Datasource) handleResource(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	fail := func(status int, message string) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": message})
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fail(405, "Catalog resources accept GET only")
		return
	}
	if d.configErr != nil {
		fail(400, d.safeError(d.configErr))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), d.timeout)
	defer cancel()
	ctx = httpclient.WithResponseLimit(ctx, 4<<20)
	select {
	case d.slots <- struct{}{}:
		defer func() { <-d.slots }()
	case <-ctx.Done():
		fail(int(errorStatus(ctx.Err())), d.safeError(ctx.Err()))
		return
	}
	params := r.URL.Query()
	database, schema, table := params.Get("database"), params.Get("schema"), params.Get("table")
	path := strings.Trim(r.URL.Path, "/")
	if (path == "schemas" || path == "tables" || path == "columns") && database == "" {
		fail(400, "database is required")
		return
	}
	if (path == "tables" || path == "columns") && schema == "" {
		fail(400, "schema is required")
		return
	}
	if path == "columns" && table == "" {
		fail(400, "table is required")
		return
	}
	options := scopedb.CatalogListOptions{PageSize: 500, PageToken: params.Get("pageToken")}
	var result any
	var err error
	switch path {
	case "databases":
		result, err = d.client.ListDatabases(ctx, options)
	case "schemas":
		result, err = d.client.ListSchemas(ctx, database, options)
	case "tables":
		result, err = d.client.ListTables(ctx, database, schema, options)
	case "columns":
		var resource scopedb.TableResource
		resource, err = d.client.FetchTable(ctx, database, schema, table)
		result = map[string]any{"columns": resource.Columns}
	default:
		fail(404, "Unknown catalog resource")
		return
	}
	if err != nil {
		fail(int(errorStatus(err)), d.safeError(err))
		return
	}
	_ = json.NewEncoder(w).Encode(result)
}
