import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const contractPath = path.join(root, 'product/v2-contract.yaml');
const contract = YAML.parse(fs.readFileSync(contractPath, 'utf8'));

const failures = [];

for (const relative of contract.required_files || []) {
  if (!fs.existsSync(path.join(root, relative))) {
    failures.push('Missing required file: ' + relative);
  }
}

for (const rule of contract.forbidden || []) {
  const target = path.join(root, rule.file);
  if (!fs.existsSync(target)) continue;
  const content = fs.readFileSync(target, 'utf8');
  for (const token of rule.tokens || []) {
    if (content.includes(token)) {
      failures.push('Forbidden token in ' + rule.file + ': ' + token);
    }
  }
}

for (const [id, feature] of Object.entries(contract.features || {})) {
  const target = path.join(root, feature.file);
  if (!fs.existsSync(target)) {
    failures.push(id + ': missing file ' + feature.file);
    continue;
  }

  const content = fs.readFileSync(target, 'utf8');
  for (const token of feature.contains || []) {
    if (!content.includes(token)) {
      failures.push(id + ': missing required token in ' + feature.file + ': ' + token);
    }
  }
}

if (failures.length) {
  console.error('\nAirCard V2 contract FAILED:\n');
  for (const failure of failures) console.error(' - ' + failure);
  console.error('\nFix the implementation or intentionally update product/v2-contract.yaml.\n');
  process.exit(1);
}

console.log(
  'AirCard V2 contract PASS:',
  Object.keys(contract.features || {}).length,
  'feature gates +',
  (contract.required_files || []).length,
  'required files'
);
