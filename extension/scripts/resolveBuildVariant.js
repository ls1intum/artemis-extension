// Pure, testable resolver for the esbuild build variant + derived flags. Three
// mutually-exclusive variants:
//   full             shipped Desktop/Marketplace: struggle on, recorder off
//   openvsx          shipped Open VSX / EduIDE clean: struggle off, recorder off
//   local-recording  local dev only: recorder on; REFUSED under CI (fail-safe)
const VARIANTS = ['full', 'openvsx', 'local-recording'];

function resolveBuildVariant({ argv = [], env = {} } = {}) {
    const flag = argv.find(a => a.startsWith('--variant='));
    const variant = flag ? flag.slice('--variant='.length) : (env.IRIS_BUILD_VARIANT || 'full');
    if (!VARIANTS.includes(variant)) {
        throw new Error(`resolveBuildVariant: unknown variant '${variant}' (expected ${VARIANTS.join(' | ')})`);
    }
    const isCI = env.GITHUB_ACTIONS === 'true' || env.CI === 'true';
    if (variant === 'local-recording' && isCI) {
        throw new Error('resolveBuildVariant: local-recording is a local-only variant and is refused under CI');
    }
    return {
        variant,
        isOpenVsx: variant === 'openvsx',
        recording: variant === 'local-recording',
    };
}

module.exports = { resolveBuildVariant, VARIANTS };
