const fs = require('fs');
const code = fs.readFileSync('src/components/DiscountEntryForm.tsx', 'utf-8');

let depth = 0;
let lines = code.split('\n');

let openTags = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Very rough JSX tag matcher
  let match;
  let re = /<([a-zA-Z0-9\.]+)([^>]*?)>/g;
  while ((match = re.exec(line)) !== null) {
    if (!line.includes('/>') && !match[0].endsWith('/>')) {
      openTags.push({tag: match[1], line: i + 1});
    }
  }
  
  let reClose = /<\/([a-zA-Z0-9\.]+)>/g;
  while ((match = reClose.exec(line)) !== null) {
    if (openTags.length > 0 && openTags[openTags.length - 1].tag === match[1]) {
      openTags.pop();
    } else if (openTags.length > 0) {
      console.log(`Mismatch at line ${i+1}: expected </${openTags[openTags.length - 1].tag}> but got </${match[1]}>`);
      openTags.pop(); // try to recover
    } else {
      console.log(`Extra close tag </${match[1]}> at line ${i+1}`);
    }
  }
}
console.log("Remaining open tags:", openTags.slice(-5));
