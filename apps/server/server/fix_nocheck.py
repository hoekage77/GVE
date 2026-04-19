import sys

def fix_nocheck(filename):
    with open(filename, 'r') as f:
        lines = f.readlines()
        
    nocheck_idx = -1
    for i, line in enumerate(lines):
        if line.strip() == '// @ts-nocheck':
            nocheck_idx = i
            break
            
    if nocheck_idx > 0:
        lines.pop(nocheck_idx)
        lines.insert(0, '// @ts-nocheck\n')
        with open(filename, 'w') as f:
            f.writelines(lines)

for file in ["index.ts", "routes/chat.ts", "routes/api.ts"]:
    fix_nocheck(file)
