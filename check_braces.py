import re

with open('frontend/components/chat/MessageList.tsx', 'r') as f:
    lines = f.readlines()

total_open = 0
total_close = 0
depth = 0
line_info = []

for i, line in enumerate(lines, 1):
    stripped = line.rstrip()
    in_string = False
    string_char = None
    in_template = False
    
    for ch in stripped:
        if in_string:
            if ch == '\\':
                continue
            elif ch == string_char:
                in_string = False
            continue
        if ch == '"' or ch == "'":
            in_string = True
            string_char = ch
            continue
        if ch == '`':
            in_template = not in_template
            continue
        if in_template:
            continue
        if ch == '{':
            total_open += 1
        elif ch == '}':
            total_close += 1
    
    cur_depth = total_open - total_close
    if cur_depth > 0:
        line_info.append((i, cur_depth, stripped[:80]))

print(f'Total {{: {total_open}, Total }}: {total_close}')
print(f'Difference: {total_open - total_close}')
print()
for ln, diff, text in line_info:
    print(f'L{ln} (depth +{diff}): {text}')
