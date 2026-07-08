const fs = require('fs');
const path = require('path');

function processDirectory(dir, replacementList) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (file === 'node_modules' || file === '.git') continue;
      processDirectory(fullPath, replacementList);
    } else if (stat.isFile()) {
      const ext = path.extname(fullPath).toLowerCase();
      if (['.js', '.html', '.css', '.json', '.xml', '.txt'].includes(ext)) {
        let content = fs.readFileSync(fullPath, 'utf8');
        let modified = false;

        for (const rep of replacementList) {
          if (content.includes(rep.find)) {
            content = content.split(rep.find).join(rep.replace);
            modified = true;
          }
        }

        if (modified) {
          fs.writeFileSync(fullPath, content, 'utf8');
        }
      }
    }
  }
}

function applyPatches(appDataPath, replacements) {
  for (const [componentName, replacementList] of Object.entries(replacements)) {
    if (!replacementList || replacementList.length === 0) continue;

    const componentDir = path.join(appDataPath, componentName);
    if (!fs.existsSync(componentDir)) continue;

    processDirectory(componentDir, replacementList);
  }
}

module.exports = { applyPatches };