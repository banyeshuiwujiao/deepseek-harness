/** Startup variables required by native executables before model evaluation. */

/** Native executable search, Windows system paths, and sandbox temporary paths retained in the OS environment. */
export const STARTUP_ENVIRONMENT_NAMES: ReadonlySet<string> = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'])

/**
 * Clear inherited credentials while preserving native child-process startup paths.
 * @param state - Child process environment, replaced with the minimal program-visible spawn object.
 */
export function clearProgramEnvironment(state: { env: NodeJS.ProcessEnv }): void {
  for (const key of Object.keys(state.env)) {
    if (!STARTUP_ENVIRONMENT_NAMES.has(key.toUpperCase())) Reflect.deleteProperty(state.env, key)
  }
  state.env = programSpawnEnvironment()
}
/**
 * Minimal spawn environment handed to program processes.
 *
 * The program-visible environment is deliberately free of inherited values (no
 * credentials leak into model-written code), but a bare executable name then
 * fails with ENOENT because nothing resolves PATH. Hand the process a minimal
 * system PATH plus the Windows system-root variables and a temp directory, so
 * git, npm, and linkers work without the model needing absolute executable paths.
 * @returns Environment variables safe for model-visible program processes.
 */
export function programSpawnEnvironment(): NodeJS.ProcessEnv {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
    // TEMP and TMP pass through independently: node's tmpdir() prefers TEMP while
    // the native ACL-lock addon keys off TMP, and tests stub them apart.
    const temp = process.env.TEMP ?? `${root}\\TEMP`
    const tmp = process.env.TMP ?? temp
    return {
      PATH: [`${root}\\System32`, `${root}\\System32\\Wbem`, root, 'C:\\Program Files', 'C:\\Program Files (x86)'].join(';'),
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      SYSTEMROOT: root,
      WINDIR: root,
      TEMP: temp,
      TMP: tmp,
    }
  }
  return { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }
}

