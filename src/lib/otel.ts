import {
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

const tracer = trace.getTracer("sourcelens");

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setAttribute("durationMs", Date.now() - started);
      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

export function currentTraceparent() {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}

export function withTraceparent<T>(traceparent: string | undefined, fn: () => Promise<T>) {
  if (!traceparent) return fn();
  const parent = propagation.extract(context.active(), { traceparent });
  return context.with(parent, fn);
}
