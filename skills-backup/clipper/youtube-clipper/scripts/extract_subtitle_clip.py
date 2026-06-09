#!/usr/bin/env python3
"""
提取字幕片段并转换为 SRT 格式
"""

import sys
import re
from datetime import timedelta


def parse_vtt_time(time_str):
    """解析 VTT 时间格式为秒"""
    parts = time_str.strip().split(':')
    if len(parts) == 3:
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
        return hours * 3600 + minutes * 60 + seconds
    elif len(parts) == 2:
        minutes = int(parts[0])
        seconds = float(parts[1])
        return minutes * 60 + seconds
    return 0


def format_srt_time(seconds):
    """格式化为 SRT 时间格式"""
    td = timedelta(seconds=seconds)
    hours = int(td.total_seconds() // 3600)
    minutes = int((td.total_seconds() % 3600) // 60)
    secs = int(td.total_seconds() % 60)
    millis = int((td.total_seconds() % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def extract_subtitle_clip(vtt_file, start_time, end_time, output_file):
    """提取字幕片段"""
    # 解析时间
    start_seconds = parse_vtt_time(start_time)
    end_seconds = parse_vtt_time(end_time)

    print(f"📝 提取字幕片段...")
    print(f"   输入: {vtt_file}")
    print(f"   时间范围: {start_time} - {end_time}")
    print(f"   时间范围（秒）: {start_seconds:.1f}s - {end_seconds:.1f}s")

    # 读取 VTT 文件
    with open(vtt_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # 解析字幕
    subtitles = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # 查找时间戳行
        if '-->' in line:
            # 解析时间戳
            time_parts = line.split('-->')
            sub_start_str = time_parts[0].strip().split()[0]
            sub_end_str = time_parts[1].strip().split()[0]

            sub_start = parse_vtt_time(sub_start_str)
            sub_end = parse_vtt_time(sub_end_str)

            # 检查是否在目标时间范围内
            if sub_start >= start_seconds and sub_end <= end_seconds:
                # 收集字幕文本
                i += 1
                text_lines = []
                while i < len(lines) and lines[i].strip() != '':
                    text_lines.append(lines[i].strip())
                    i += 1

                text = ' '.join(text_lines)

                # 调整时间戳（减去起始时间）
                adjusted_start = sub_start - start_seconds
                adjusted_end = sub_end - start_seconds

                subtitles.append({
                    'start': adjusted_start,
                    'end': adjusted_end,
                    'text': text
                })

        i += 1

    print(f"   找到 {len(subtitles)} 条字幕")

    # 写入 SRT 格式
    with open(output_file, 'w', encoding='utf-8') as f:
        for idx, sub in enumerate(subtitles, 1):
            f.write(f"{idx}\n")
            f.write(f"{format_srt_time(sub['start'])} --> {format_srt_time(sub['end'])}\n")
            f.write(f"{sub['text']}\n")
            f.write("\n")

    print(f"✅ 字幕提取完成")
    print(f"   输出文件: {output_file}")
    print(f"   字幕条数: {len(subtitles)}")

    return subtitles


if __name__ == '__main__':
    if len(sys.argv) != 5:
        print("用法: python extract_subtitle_clip.py <vtt_file> <start_time> <end_time> <output_file>")
        print("示例: python extract_subtitle_clip.py input.vtt 00:05:47 00:09:19 output.srt")
        sys.exit(1)

    vtt_file = sys.argv[1]
    start_time = sys.argv[2]
    end_time = sys.argv[3]
    output_file = sys.argv[4]

    extract_subtitle_clip(vtt_file, start_time, end_time, output_file)