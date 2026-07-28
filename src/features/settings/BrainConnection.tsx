import { useEffect, useRef, useState } from "react";
import { Button, Receipt } from "../../ui";
import { ASSISTANT } from "../../shell/terms";
import {
  brainStatus,
  brainTestConnection,
  commandErrorMessage,
  executeCommand,
  type BrainStatus,
  type BrainTestResult,
  type CommandInvoker,
} from "../../services/command";

/**
 * Truthful Brain configuration block. The status dot/line reflects `brain_status`
 * (no network — just key presence + settings), and Test connection runs a real
 * `brain_test_connection` round-trip, surfacing model + latency on success or
 * the exact backend reason on failure. Never displays or transmits a secret.
 */
export function BrainConnection({ invoker }: { invoker?: CommandInvoker }) {
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<BrainTestResult | null>(null);
  const mounted = useRef(true);

  const loadStatus = () => {
    executeCommand(brainStatus, undefined, invoker)
      .then((next) => {
        if (!mounted.current) return;
        setStatus(next);
        setStatusError(null);
      })
      .catch((cause) => {
        if (!mounted.current) return;
        setStatus(null);
        setStatusError(
          commandErrorMessage(cause, `${ASSISTANT} status unavailable.`),
        );
      });
  };

  useEffect(() => {
    mounted.current = true;
    loadStatus();
    return () => {
      mounted.current = false;
    };
    // Reload if the invoker seam changes (tests inject different invokers).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoker]);

  const test = async () => {
    if (testing) return;
    setTesting(true);
    setResult(null);
    try {
      const next = await executeCommand(
        brainTestConnection,
        undefined,
        invoker,
      );
      if (mounted.current) setResult(next);
    } catch (cause) {
      if (mounted.current) {
        setResult({
          ok: false,
          provider: null,
          model: null,
          latency_ms: null,
          error: commandErrorMessage(
            cause,
            "The connection test could not run.",
          ),
        });
      }
    } finally {
      if (mounted.current) setTesting(false);
      loadStatus();
    }
  };

  const online = status?.online === true;
  const statusLine = statusError
    ? `○ status unavailable — ${statusError}`
    : status == null
      ? `Checking ${ASSISTANT} connection…`
      : online
        ? `● configured — ${status.provider ?? "provider configured"}`
        : `○ offline — ${status.reason ?? "no provider configured"}`;

  return (
    <div className="brain-connection" aria-label={`${ASSISTANT} connection`}>
      <p
        className={`brain-connection-line is-${online ? "online" : "offline"}`}
        role="status"
        data-online={online}
      >
        {statusLine}
      </p>

      <div className="brain-connection-actions">
        <Button variant="text" onClick={() => void test()} disabled={testing}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
      </div>

      {result != null &&
        (result.ok ? (
          <Receipt
            status="success"
            message={`Connected — ${result.provider ?? "provider"} · ${result.model ?? "model"} · ${result.latency_ms ?? "?"} ms`}
          />
        ) : (
          <Receipt
            status="error"
            message={result.error ?? "The connection test failed."}
          />
        ))}
    </div>
  );
}
