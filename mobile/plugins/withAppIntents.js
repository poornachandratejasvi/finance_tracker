const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Files in mobile/ios-native/ that need to end up compiled into the main app target.
// APIConfig.swift is generated from APIConfig.swift.template by CI (see
// .github/workflows/mobile-ipa-unsigned.yml) -- it must exist on disk before prebuild runs.
const SOURCE_FILES = ["AddTransactionIntent.swift", "APIConfig.swift"];

// expo prebuild regenerates ios/ from scratch every run, so anything native has to be
// re-injected each time rather than committed directly into ios/ -- this plugin does that:
// copy our Swift sources into the generated project, then wire them into the Xcode
// project's main target so they actually get compiled.

function withAppIntentFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformProjectRoot = config.modRequest.platformProjectRoot;
      const projectName = config.modRequest.projectName;
      const targetDir = path.join(platformProjectRoot, projectName);
      const sourceDir = path.join(projectRoot, "ios-native");

      for (const file of SOURCE_FILES) {
        const src = path.join(sourceDir, file);
        if (!fs.existsSync(src)) {
          throw new Error(
            `withAppIntents: expected ${src} to exist.` +
              (file === "APIConfig.swift"
                ? " Generate it from ios-native/APIConfig.swift.template (substituting" +
                  " FINANCE_SERVER_URL / FINANCE_API_TOKEN) before running prebuild."
                : "")
          );
        }
        fs.copyFileSync(src, path.join(targetDir, file));
      }

      return config;
    },
  ]);
}

function withAppIntentXcodeProject(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectName = config.modRequest.projectName;
    const targetUuid = project.getFirstTarget().uuid;
    const groupKey = project.findPBXGroupKey({ name: projectName });

    for (const file of SOURCE_FILES) {
      if (!project.hasFile(file)) {
        project.addSourceFile(file, { target: targetUuid }, groupKey);
      }
    }

    return config;
  });
}

module.exports = function withAppIntents(config) {
  config = withAppIntentFiles(config);
  config = withAppIntentXcodeProject(config);
  return config;
};
