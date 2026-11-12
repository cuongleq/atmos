/**
 * ATMOS Health Check & Monitoring
 * Embeds in the web app for client-side SLA monitoring
 */

// Health check endpoint response
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: string;
  checks: {
    webapp: { ok: boolean; latency: number; message: string };
    openMeteo: { ok: boolean; latency: number; message: string };
    benchmark: { ok: boolean; ageHours: number; message: string };
  };
  version: string;
}

/**
 * Client-side health check - runs in browser
 * Can be called periodically to monitor app health
 */
export async function runHealthCheck(): Promise<HealthStatus> {
  const start = performance.now();
  const checks = {
    webapp: { ok: false, latency: 0, message: '' },
    openMeteo: { ok: false, latency: 0, message: '' },
    benchmark: { ok: false, ageHours: 0, message: '' },
  };

  // 1. Check webapp (self)
  try {
    const t0 = performance.now();
    const resp = await fetch(window.location.origin + '/', { 
      method: 'HEAD',
      cache: 'no-cache',
      signal: AbortSignal.timeout(5000),
    });
    checks.webapp.latency = performance.now() - t0;
    checks.webapp.ok = resp.ok;
    checks.webapp.message = resp.ok ? 'OK' : `HTTP ${resp.status}`;
  } catch (e) {
    checks.webapp.latency = performance.now() - start;
    checks.webapp.ok = false;
    checks.webapp.message = e instanceof Error ? e.message : 'Unknown error';
  }

  // 2. Check Open-Meteo API
  try {
    const t0 = performance.now();
    const resp = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=16&longitude=108&hourly=temperature_2m&forecast_days=1',
      { signal: AbortSignal.timeout(5000) }
    );
    checks.openMeteo.latency = performance.now() - t0;
    checks.openMeteo.ok = resp.ok;
    checks.openMeteo.message = resp.ok ? 'OK' : `HTTP ${resp.status}`;
  } catch (e) {
    checks.openMeteo.ok = false;
    checks.openMeteo.message = e instanceof Error ? e.message : 'Unknown error';
  }

  // 3. Check benchmark.json freshness
  try {
    const resp = await fetch(window.location.origin + '/benchmark.json', { 
      cache: 'no-cache',
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const createdAt = data.createdAt ? new Date(data.createdAt).getTime() : 0;
      const ageHours = createdAt ? (Date.now() - createdAt) / 3600000 : 999;
      checks.benchmark.ok = ageHours < 48;
      checks.benchmark.ageHours = Math.round(ageHours * 10) / 10;
      checks.benchmark.message = ageHours < 48 
        ? `Fresh (${checks.benchmark.ageHours}h old)` 
        : `Stale (${checks.benchmark.ageHours}h old)`;
    } else {
      checks.benchmark.ok = false;
      checks.benchmark.message = `HTTP ${resp.status}`;
    }
  } catch (e) {
    checks.benchmark.ok = false;
    checks.benchmark.message = e instanceof Error ? e.message : 'Unknown error';
  }

  // Overall status
  const allOk = Object.values(checks).every(c => c.ok);
  const anyCriticalDown = !checks.webapp.ok || !checks.openMeteo.ok;
  
  return {
    status: anyCriticalDown ? 'down' : allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
    version: '1.0.0',
  };
}

/**
 * Start periodic health monitoring
 * Reports to console and can be extended to send to monitoring service
 */
export function startHealthMonitoring(intervalMs = 5 * 60 * 1000) {
  console.log('[Health] Starting periodic monitoring...');
  
  const run = async () => {
    const status = await runHealthCheck();
    
    // Log to console
    const emoji = status.status === 'healthy' ? '✅' : status.status === 'degraded' ? '⚠️' : '❌';
    console.log(`[Health] ${emoji} ${status.status.toUpperCase()}`, status.checks);
    
    // Report to monitoring service (replace with your endpoint)
    if (status.status !== 'healthy') {
      await reportToMonitoring(status);
    }
    
    return status;
  };
  
  // Initial run
  void run();
  
  // Periodic runs
  const timer = setInterval(run, intervalMs);
  
  return {
    stop: () => clearInterval(timer),
    runOnce: run,
  };
}

/**
 * Send health status to monitoring endpoint
 * Replace with your monitoring service (Datadog, New Relic, custom, etc.)
 */
async function reportToMonitoring(status: HealthStatus): Promise<void> {
  // @ts-expect-error - Vite injects import.meta.env at build time
  const endpoint = import.meta.env?.VITE_MONITORING_ENDPOINT;
  if (!endpoint) {
    return;
  }
  
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'atmos-webapp',
        // @ts-expect-error - Vite injects import.meta.env at build time
        environment: import.meta.env?.MODE,
        ...status,
      }),
      keepalive: true,
    });
  } catch {
    // Silently fail - monitoring shouldn't break the app
  }
}

/**
 * Expose health check on window for manual testing
 */
if (typeof window !== 'undefined') {
  // @ts-expect-error - Intentional extension of window for debugging
  window.__ATMOS_HEALTH__ = {
    runCheck: runHealthCheck,
    startMonitoring: startHealthMonitoring,
  };
}