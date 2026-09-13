/**
 * A real, non-dependency-injected CcPeer.create() spawns a genuine child process to read its own start time (ps on POSIX, powershell.exe on Windows) — unlike the DI-based fixtures elsewhere in this suite, there is no fake procInfo to short-circuit that cost. PowerShell's own startup latency varies by host; ARM Windows CI runners in particular have been observed exceeding vitest's default test timeout here, most plausibly from an x64-under-emulation PowerShell cold start. This is genuine subprocess latency to accommodate, not a correctness concern, so every test exercising a real CcPeer.create() uses this generous headroom.
 */
export const REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS = 20_000;
