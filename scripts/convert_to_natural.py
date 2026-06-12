#!/usr/bin/env python3
"""Convert numbered chain headers to natural language flow in the seedance prompt file."""
import re

FILE = "/home/ubuntu/workspace/ai-space/video/seedance_古装雨夜木廊桥_女剑客男枪客_高速版.txt"

with open(FILE, 'r', encoding='utf-8') as f:
    raw = f.read()

# Step 0: Strip read_file format prefixes if present
lines = raw.split('\n')
cleaned = []
for line in lines:
    m = re.match(r'^\s*(\d+)\|(.*)', line)
    if m:
        content = m.group(2)
        # Also strip a possible second prefix
        m2 = re.match(r'^\s*\d+\|(.*)', content)
        if m2:
            cleaned.append(m2.group(1))
        else:
            cleaned.append(content)
    else:
        cleaned.append(line)
raw = '\n'.join(cleaned)

# Step 1: Fix the header definition section
raw = re.sub(
    r'每个动作必须拆分为\{1\.蓄力→2\.爆发→3\.接触→4\.结果\}四步显式因果链.*?(?=\n)',
    '本片每个动作遵循完整因果链：蓄力（身体准备）→ 爆发（力量释放）→ 接触（精准碰撞）→ 结果（反作用力后果）',
    raw
)

raw = re.sub(r'【1\.蓄力】= ', '蓄力 = ', raw)
raw = re.sub(r'【2\.爆发】= ', '爆发 = ', raw)
raw = re.sub(r'【3\.接触】= ', '接触 = ', raw)
raw = re.sub(r'【4\.结果】= ', '结果 = ', raw)

raw = re.sub(r'禁止AI跳过1直达4，禁止AI凭空完成2而无3。\n', '', raw)
raw = re.sub(r'此四步必须在每个出手的相邻画面序列中依次完成.*?(?=\n\n|\n#|\n##)', '', raw)
raw = re.sub(r'每个出手 = 独立的 \{1→2→3→4\} 因果链', '每个出手 = 独立的蓄力→爆发→接触→结果因果链', raw)

# Now process line by line for the body
lines = raw.split('\n')
output = []
i = 0
n = len(lines)

pat_step = re.compile(r'^【(\d+)[\.．](蓄力|爆发|接触|结果)(（[^）]*?）)?】\s*(.*)')
pat_sub  = re.compile(r'^【(第一点|第二点|第三点)[\.．·]*([^】]*)】\s*(.*)')

def merge_steps(steps, genders):
    """Merge a list of step contents into a natural language paragraph.
    genders is parallel list of gender suffixes ('' or '（男）' etc.)
    Returns a list of paragraph strings (one if single gender, multiple if dual chain)
    """
    if not steps:
        return []

    # Group by gender
    groups = {}
    for i, (step, g) in enumerate(zip(steps, genders)):
        if g not in groups:
            groups[g] = []
        groups[g].append(step)

    results = []
    for gender_key, st in groups.items():
        if len(st) >= 4:
            merged = f'{st[0]}，紧接着{st[1]}——{st[2]}。{st[3]}'
        elif len(st) == 3:
            merged = f'{st[0]}，随即{st[1]}——{st[2]}。'
        elif len(st) == 2:
            merged = f'{st[0]}，{st[1]}。'
        elif len(st) == 1:
            merged = st[0]
        else:
            merged = '；'.join(st)

        # Ensure it ends with proper punctuation
        if not merged.rstrip().endswith(('。', '！', '？', '」', '』', ')', '）', '」', '』')):
            merged = merged.rstrip() + '。'

        if gender_key:
            merged = f'（{gender_key.strip("（）")}）{merged}'

        results.append(merged)

    return results

while i < n:
    stripped = lines[i].rstrip()

    if not stripped:
        output.append('')
        i += 1
        continue

    # Check for sub-point header (第一点/第二点/第三点)
    sub_m = pat_sub.match(stripped)
    if sub_m:
        point_label = sub_m.group(1)
        point_desc = sub_m.group(2)
        first_content = sub_m.group(3)

        i += 1
        steps = []
        genders = []
        if first_content:
            steps.append(first_content)
            genders.append('')

        # Collect step lines
        while i < n:
            next_line = lines[i]
            next_stripped = next_line.rstrip()
            if not next_stripped:
                break
            if next_stripped.startswith('### '):
                break
            if pat_sub.match(next_stripped):
                break
            step_m = pat_step.match(next_stripped)
            if step_m:
                steps.append(step_m.group(4))
                genders.append(step_m.group(3) or '')
                i += 1
            else:
                break

        # Merge
        paras = merge_steps(steps, genders)
        for p in paras:
            output.append(f'{point_label}：{p}')

        continue

    # Check for numbered chain header
    step_m = pat_step.match(stripped)
    if step_m:
        steps = [step_m.group(4)]
        genders = [step_m.group(3) or '']
        i += 1

        while i < n:
            next_line = lines[i]
            next_stripped = next_line.rstrip()
            if not next_stripped:
                break
            if next_stripped.startswith('### '):
                break
            if pat_sub.match(next_stripped):
                break
            next_m = pat_step.match(next_stripped)
            if next_m:
                steps.append(next_m.group(4))
                genders.append(next_m.group(3) or '')
                i += 1
            else:
                break

        paras = merge_steps(steps, genders)
        for p in paras:
            output.append(p)

        continue

    # Regular line - passthrough
    output.append(lines[i])
    i += 1

result = '\n'.join(output)

# Clean up excessive blank lines
result = re.sub(r'\n{4,}', '\n\n\n', result)

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(result)

# Stats
remaining = len(re.findall(r'【\d+[\.．]蓄力】', result))
remaining_sub = len(re.findall(r'【第一点', result))
print(f"Converted: {len(raw)} -> {len(result)} chars")
print(f"Remaining numbered chains: {remaining} (target: 0)")
print(f"Remaining subpoints: {remaining_sub} (target: 0)")
print("DONE")
