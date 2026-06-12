#!/usr/bin/env python3
"""
Merge all 出手 blocks within each lens into continuous flowing paragraphs.
Removes ### 出手N headers, (男→女) labels, and adds natural bridging between exchanges.
"""
import re

FILE = "/home/ubuntu/workspace/ai-space/video/seedance_古装雨夜木廊桥_女剑客男枪客_高速版.txt"

with open(FILE, 'r', encoding='utf-8') as f:
    text = f.read()

lines = text.split('\n')
output = []
i = 0
n = len(lines)

# Bridge phrase selection based on context
# We'll track what happened in the previous 出手 and what's starting in the next
BRIDGES = {
    # Generic bridges (used when no specific context)
    'generic': [
        '枪杆尚未完全回正，',
        '前次碰撞的余震尚未消散，',
        '水面被冲击力炸出的弧线尚未落地，',
        '不等前次冲击的震颤完全消失，',
        '就在这一瞬间——',
        '同一刻——',
        '雨水从碰撞点炸散的雾尚未散尽，',
    ],
    # Between two male attacks
    'male_x2': [
        '男枪客不等她抓住这个间隙，',
        '男枪客不给她任何喘息窗口，',
        '他的反应更快——枪头还未完全回正，下一击已经启动。',
        '枪杆弹性尚未完全释放，男枪客已经借回弹力拉回枪头，',
    ],
    # Male -> Female counter
    'male_to_female': [
        '她不等剑尖弹回中线，',
        '她不是被动防御——',
        '她不退反进——',
        '她趁他重心前压的瞬间，',
    ],
    # Female -> Male response
    'female_to_male': [
        '他立刻还以颜色——',
        '他趁她刚落地重心未稳，',
        '男枪客不等她站稳脚跟，',
        '他的封堵紧随其后——',
    ],
    # After a block that ends with a defense
    'after_defense': [
        '防守刚完，下一波攻势已经压到眼前——',
        '她刚卸开一势，他的补位已经到来——',
        '她才偏开枪杆的方向，他的下一枪已经变线。',
    ],
}

import random
random.seed(42)

def choose_bridge(category='generic'):
    return random.choice(BRIDGES.get(category, BRIDGES['generic']))

def get_direction(text):
    """Determine the direction of the action based on content."""
    if re.search(r'^(男枪客|他（男|男枪客|枪杆)', text):
        return 'male'
    elif re.search(r'^(她（女|女剑客|她|剑脊|剑尖|剑身)', text):
        return 'female'
    return None

def first_person_word(text):
    """Get the first meaningful word of the text to check who's acting."""
    m = re.match(r'^(（男）|（女）|（女）|（男）)?\s*(\S+)', text)
    if m:
        return m.group(2)
    return ''

def strip_person_prefix(text):
    """Remove leading person reference (男枪客、她、他) for merging."""
    # Remove gender markers
    text = re.sub(r'^（(男|女)）\s*', '', text)
    # Remove leading person references
    text = re.sub(r'^(男枪客|他|她|女剑客)\s*', '', text)
    return text

# Process line by line, tracking state
current_lens = None
in_chushou = False
chushou_buffer = []
special_blocks = []  # For ⚡ blocks, 【场景建立】, etc.

# Parse the file into sections
sections = []
current_section = None

for line in lines:
    stripped = line.rstrip()

    if stripped.startswith('## 镜头'):
        if current_section:
            sections.append(current_section)
        current_section = {'type': 'lens', 'header': stripped, 'content': [], 'blocks': []}
        current_lens = stripped
        continue

    if stripped.startswith('### 出手'):
        # Start a new 出手 block
        if current_section:
            current_section['blocks'].append({
                'type': 'chushou',
                'header': stripped,
                'content': []
            })
        continue

    if stripped.startswith('### ⚡'):
        if current_section:
            current_section['blocks'].append({
                'type': 'special',
                'header': stripped,
                'content': []
            })
        continue

    if current_section:
        if current_section['blocks']:
            current_section['blocks'][-1]['content'].append(stripped)
        else:
            current_section['content'].append(stripped)

if current_section:
    sections.append(current_section)

# Now process each section: merge 出手 blocks into continuous flow
def process_section(section):
    """Merge all 出手 blocks into flowing paragraphs."""
    output_lines = []

    # Add section header content that's before the first block
    for line in section['content']:
        output_lines.append(line)

    # Process blocks in order
    blocks = section['blocks']
    prev_direction = None

    for idx, block in enumerate(blocks):
        if block['type'] == 'special':
            # Keep ⚡ special blocks as-is with a blank line before and after
            # But add a flow connector from previous content
            if output_lines and output_lines[-1] != '':
                output_lines.append('')
            output_lines.append(block['header'])
            for line in block['content']:
                if line:
                    output_lines.append(f'    {line}')
            if output_lines[-1] != '':
                output_lines.append('')
            prev_direction = None
            continue

        # This is a 出手 block
        block_text = '\n'.join(block['content'])
        block_text = block_text.strip()

        if not block_text:
            continue

        # Determine direction from the header
        header = block['header']
        dir_match = re.search(r'（(.*?)）', header)
        raw_direction = dir_match.group(1) if dir_match else ''

        # Determine the direction based on header
        if '男→女' in raw_direction:
            direction = 'male_to_female'
        elif '女→男' in raw_direction:
            direction = 'female_to_male'
        elif '男→女→女→男' in raw_direction:
            direction = 'dual'
        else:
            direction = 'generic'

        # For the first block, just output the content as-is (no bridge needed)
        if idx == 0 or prev_direction is None:
            output_lines.append(block_text)
            prev_direction = direction
            continue

        # Add a bridging phrase between blocks
        bridge = ''

        if raw_direction == 'generic' or not raw_direction:
            bridge = choose_bridge('generic')
        elif direction == 'male_to_female' and prev_direction == 'male_to_female':
            bridge = choose_bridge('male_x2')
        elif direction == 'female_to_male' and prev_direction == 'male_to_female':
            # Look at the first line of this block
            first_line = block_text.split('\n')[0] if block_text else ''
            if '不' in first_line or '顶' in first_line or '反' in first_line:
                bridge = choose_bridge('male_to_female')
            else:
                bridge = choose_bridge('after_defense')
        elif direction == 'male_to_female' and prev_direction == 'female_to_male':
            bridge = choose_bridge('female_to_male')
        elif direction == 'female_to_male' and prev_direction == 'female_to_male':
            bridge = choose_bridge('after_defense')
        elif direction == 'dual':
            bridge = choose_bridge('generic')
        else:
            bridge = choose_bridge('generic')

        # Add the bridge + content
        # For clean flow, strip leading person reference and gender marker from the block text
        # so it reads as continuation
        block_cleaned = re.sub(r'^（男）\s*', '', block_text)
        block_cleaned = re.sub(r'^（女）\s*', '', block_cleaned)
        block_cleaned = re.sub(r'^（男）\s*', '', block_cleaned)

        # If content starts with 男枪客/他/她/女剑客 and we have a bridge that already indicates the actor,
        # we can optionally strip the person ref, but let's keep it for clarity
        output_lines.append(f'{bridge}{block_cleaned}')
        prev_direction = direction

    return '\n'.join(output_lines)

# Process each section
final_parts = []
for section in sections:
    processed = process_section(section)
    header = section['header']
    final_parts.append(header)
    final_parts.append(processed)

result = '\n\n'.join(final_parts)

# Clean up
# 1. Remove excessive blank lines
result = re.sub(r'\n{4,}', '\n\n\n', result)
# 2. Remove blank lines before and after ⚡ blocks
result = re.sub(r'\n\n+### ⚡', '\n\n### ⚡', result)
result = re.sub(r'### ⚡[^\n]*\n\n\n+', lambda m: m.group(0).rstrip('\n') + '\n\n', result)

# Also fix the top part (before the first lens section) - it should stay as-is
# The 全链路动能追踪 section and core constraints should remain

# Count original vs new
original_headers = len(re.findall(r'^### 出手\d+', text, re.MULTILINE))
new_headers = len(re.findall(r'^### 出手\d+', result, re.MULTILINE))
print(f"Original 出手 headers: {original_headers}")
print(f"Remaining 出手 headers: {new_headers}")
print(f"Chars: {len(text)} -> {len(result)}")

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(result)

print("DONE")
