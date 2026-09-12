/** Process-info port: the liveness and proc-start facts the roster needs. */
export interface ProcInfo {
  alive: (pid: number) => Promise<boolean>;
  /**
   * The process start string, byte-equal to `LC_ALL=C TZ=UTC ps -o lstart=` output — the exact value the receiver's registry byte-compares against.
   */
  lstart: (pid: number) => Promise<string | undefined>;
}
