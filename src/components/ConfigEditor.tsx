import React from 'react';
import { InlineField, Input, SecretInput } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { MyDataSourceOptions, MySecureJsonData } from '../types';
type Props = DataSourcePluginOptionsEditorProps<MyDataSourceOptions, MySecureJsonData>;
export function ConfigEditor({ onOptionsChange, options }: Props) {
  return (
    <div data-testid="scopedb-config">
      <InlineField label="Endpoint" labelWidth={20} tooltip="ScopeDB workspace URL, reachable from the Grafana server">
        <Input
          id="scopedb-endpoint"
          width={60}
          value={options.jsonData.endpoint ?? ''}
          placeholder="https://your-workspace.scopedb.cloud"
          onChange={(e) =>
            onOptionsChange({ ...options, jsonData: { ...options.jsonData, endpoint: e.currentTarget.value } })
          }
        />
      </InlineField>
      <InlineField
        label="API key"
        labelWidth={20}
        tooltip="Stored securely by Grafana; used only by the plugin backend"
      >
        <SecretInput
          id="scopedb-api-key"
          width={60}
          value={options.secureJsonData?.apiKey ?? ''}
          isConfigured={options.secureJsonFields?.apiKey}
          onChange={(e) =>
            onOptionsChange({
              ...options,
              secureJsonData: { ...options.secureJsonData, apiKey: e.currentTarget.value },
            })
          }
          onReset={() =>
            onOptionsChange({
              ...options,
              secureJsonFields: { ...options.secureJsonFields, apiKey: false },
              secureJsonData: { ...options.secureJsonData, apiKey: '' },
            })
          }
        />
      </InlineField>
      <InlineField
        label="Timeout (seconds)"
        labelWidth={20}
        tooltip="1–300 seconds; includes submission, polling, and result download"
      >
        <Input
          id="scopedb-timeout"
          type="number"
          min={1}
          max={300}
          width={16}
          value={options.jsonData.timeoutSeconds ?? 30}
          onChange={(e) =>
            onOptionsChange({
              ...options,
              jsonData: { ...options.jsonData, timeoutSeconds: Number(e.currentTarget.value) },
            })
          }
        />
      </InlineField>
      <InlineField
        label="Concurrent queries"
        labelWidth={20}
        tooltip="Maximum in-flight requests per data source instance (1–32); queued work shares the query timeout"
      >
        <Input
          id="scopedb-concurrency"
          type="number"
          min={1}
          max={32}
          width={16}
          value={options.jsonData.maxConcurrentQueries ?? 4}
          onChange={(e) =>
            onOptionsChange({
              ...options,
              jsonData: { ...options.jsonData, maxConcurrentQueries: Number(e.currentTarget.value) },
            })
          }
        />
      </InlineField>
      <p>Save &amp; test runs SELECT 1 AS ok against ScopeDB. Queries run on the Grafana server using this API key.</p>
    </div>
  );
}
