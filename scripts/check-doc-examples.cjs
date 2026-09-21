const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

function parseYamlExamples(markdown, filename) {
  return [...markdown.matchAll(/^[ \t]*```ya?ml[^\r\n]*\r?\n([\s\S]*?)^[ \t]*```/gm)]
    .map((match, index) => {
      try {
        return yaml.load(match[1]);
      } catch (error) {
        throw new Error(`${filename} YAML block ${index + 1}: ${error.message}`);
      }
    });
}

function checkDocumentation(root, version) {
  let count = 0;
  for (const name of fs.readdirSync(root).filter((name) => name.endsWith(".md"))) {
    const examples = parseYamlExamples(fs.readFileSync(path.join(root, name), "utf8"), name);
    count += examples.length;
    for (const example of examples) {
      if (example?.services?.scrubarr && example.services.scrubarr.image !== `ghcr.io/scrubarr/scrubarr:v${version}`) {
        throw new Error(`${name} install image does not match v${version}`);
      }
    }
    if (name === "INSTALL.md" && examples.filter((example) => example?.services?.scrubarr).length !== 2) {
      throw new Error("INSTALL.md must include valid Windows and Linux Scrubarr Compose examples");
    }
  }
  for (const name of ["docker-compose.yml", "docker-compose.example.yml"]) {
    yaml.load(fs.readFileSync(path.join(root, name), "utf8"));
  }
  return count;
}

module.exports = { parseYamlExamples, checkDocumentation };
