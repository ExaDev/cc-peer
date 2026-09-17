/**
 * A real, non-dependency-injected CcPeer.create() spawns a genuine child process to read its own start time (ps on POSIX, powershell.exe on Windows) — unlike the DI-based fixtures elsewhere in this suite, there is no fake procInfo to short-circuit that cost. PowerShell's own startup latency varies by host; ARM Windows CI runners in particular have been observed exceeding vitest's default test timeout here, most plausibly from an x64-under-emulation PowerShell cold start. This is genuine subprocess latency to accommodate, not a correctness concern, so every test exercising a real CcPeer.create() uses this generous headroom.
 */
export const REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS = 20_000;

/**
 * A test that creates, times, stats and removes on the order of hundreds of individual files sequentially (e.g. exercising sweepSpool's own batch cap) issues far more filesystem syscalls than vitest's default test timeout was ever sized for, on any platform — NTFS under CI disk contention has been observed pushing this over 5000ms on a windows-latest runner even though the identical code path stayed well within it on the same run's ubuntu and windows-11-arm legs. Real I/O volume to accommodate, not a correctness concern.
 */
export const HEAVY_FS_IO_TEST_TIMEOUT_MS = 20_000;

/**
 * Starting the packaged SEA binary is a heavier cold start than a plain CcPeer.create(): it loads and JIT-compiles one large single-file bundle (every dependency inlined, no node_modules resolution to spread the cost across smaller files) rather than a normal small script. A real macos-26-intel CI runner — the first run to ever actually reach this check, since every earlier attempt queued forever against the since-retired macos-13 label — took longer than REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS's own 20s here, confirming this is genuine startup cost on that runner class rather than a hang.
 */
export const SEA_BINARY_STARTUP_TIMEOUT_MS = 60_000;
