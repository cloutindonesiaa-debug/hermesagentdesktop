#!/usr/bin/env python3
"""
翻译字幕
批量翻译优化：每批 20 条字幕一起翻译，节省 95% API 调用
"""

import sys
import json
from pathlib import Path
from typing import List, Dict

from utils import seconds_to_time


def translate_subtitles_batch(
    subtitles: List[Dict],
    batch_size: int = 20,
    target_lang: str = "中文"
) -> List[Dict]:
    """
    批量翻译字幕

    注意：此函数需要在 Claude Code Skill 环境中调用
    Claude 会自动处理翻译逻辑

    Args:
        subtitles: 字幕列表（每项包含 {start, end, text}）
        batch_size: 每批翻译的字幕数量
        target_lang: 目标语言

    Returns:
        List[Dict]: 翻译后的字幕列表，每项包含 {start, end, text, translation}
    """
    print(f"\n🌐 开始翻译字幕...")
    print(f"   总条数: {len(subtitles)}")
    print(f"   批量大小: {batch_size}")
    print(f"   目标语言: {target_lang}")

    # 准备批量翻译数据
    batches = []
    for i in range(0, len(subtitles), batch_size):
        batch = subtitles[i:i + batch_size]
        batches.append(batch)

    print(f"   分为 {len(batches)} 批")

    # 输出待翻译文本（供 Claude 处理）
    print("\n" + "="*60)
    print("待翻译字幕（JSON 格式）:")
    print("="*60)
    print(json.dumps(subtitles, indent=2, ensure_ascii=False))

    print("\n" + "="*60)
    print("翻译要求:")
    print("="*60)
    print(f"""
请将上述字幕翻译为{target_lang}。

翻译要求：
1. 保持技术术语的准确性
2. 口语化表达（适合短视频）
3. 简洁流畅（避免冗长）
4. 保持原意，不要添加或删减内容

输出格式（JSON）：
[
  {{"start": 0.0, "end": 3.5, "text": "原文", "translation": "译文"}},
  {{"start": 3.5, "end": 7.2, "text": "原文", "translation": "译文"}},
  ...
]

请分批翻译，每批 {batch_size} 条。
    """)

    # 注意：实际翻译由 Claude 在 Skill 执行时完成
    # 这个脚本只是准备数据和提供接口
    # 返回占位符数据
    translated_subtitles = []
    for sub in subtitles:
        translated_subtitles.append({
            'start': sub['start'],
            'end': sub['end'],
            'text': sub['text'],
            'translation': '[待翻译]'  # Claude 会在运行时替换
        })

    return translated_subtitles


def create_bilingual_subtitles(
    subtitles: List[Dict],
    output_path: str,
    english_first: bool = True
) -> str:
    """
    创建双语字幕文件（SRT 格式）

    Args:
        subtitles: 字幕列表（包含 text 和 translation）
        output_path: 输出文件路径
        english_first: 英文在上（True）或中文在上（False）

    Returns:
        str: 输出文件路径
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"\n📝 生成双语字幕文件...")
    print(f"   输出: {output_path}")
    print(f"   顺序: {'英文在上，中文在下' if english_first else '中文在上，英文在下'}")

    with open(output_path, 'w', encoding='utf-8') as f:
        for i, sub in enumerate(subtitles, 1):
            # SRT 序号
            f.write(f"{i}\n")

            # SRT 时间戳
            start_time = seconds_to_time(sub['start'], include_hours=True, use_comma=True)
            end_time = seconds_to_time(sub['end'], include_hours=True, use_comma=True)
            f.write(f"{start_time} --> {end_time}\n")

            # 双语文本
            english = sub['text']
            chinese = sub.get('translation', '[未翻译]')

            if english_first:
                f.write(f"{english}\n{chinese}\n")
            else:
                f.write(f"{chinese}\n{english}\n")

            # 空行分隔
            f.write("\n")

    print(f"✅ 双语字幕已保存: {output_path}")
    return str(output_path)


def load_subtitles_from_srt(srt_path: str) -> List[Dict]:
    """
    从 SRT 文件加载字幕

    Args:
        srt_path: SRT 文件路径

    Returns:
        List[Dict]: 字幕列表
    """
    try:
        import pysrt
    except ImportError:
        print("❌ Error: pysrt not installed")
        print("Please install: pip install pysrt")
        sys.exit(1)

    srt_path = Path(srt_path)
    if not srt_path.exists():
        raise FileNotFoundError(f"SRT file not found: {srt_path}")

    print(f"📂 加载 SRT 字幕: {srt_path.name}")

    subs = pysrt.open(srt_path)
    subtitles = []

    for sub in subs:
        # 转换时间为秒数
        start = sub.start.hours * 3600 + sub.start.minutes * 60 + sub.start.seconds + sub.start.milliseconds / 1000
        end = sub.end.hours * 3600 + sub.end.minutes * 60 + sub.end.seconds + sub.end.milliseconds / 1000

        subtitles.append({
            'start': start,
            'end': end,
            'text': sub.text.replace('\n', ' ')  # 合并多行
        })

    print(f"   找到 {len(subtitles)} 条字幕")
    return subtitles


def main():
    """命令行入口"""
    if len(sys.argv) < 2:
        print("Usage: python translate_subtitles.py <subtitle_file> [output_file] [batch_size]")
        print("\nArguments:")
        print("  subtitle_file - 字幕文件路径（SRT 格式）")
        print("  output_file   - 输出文件路径（可选，默认为 <原文件名>_bilingual.srt）")
        print("  batch_size    - 每批翻译数量（可选，默认 20）")
        print("\nExample:")
        print("  python translate_subtitles.py subtitle.srt")
        print("  python translate_subtitles.py subtitle.srt bilingual.srt")
        print("  python translate_subtitles.py subtitle.srt bilingual.srt 30")
        print("\nNote:")
        print("  此脚本在 Claude Code Skill 中运行时，Claude 会自动处理翻译")
        print("  独立运行时，会输出待翻译数据供手动处理")
        sys.exit(1)

    subtitle_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    batch_size = int(sys.argv[3]) if len(sys.argv) > 3 else 20

    try:
        # 加载字幕
        subtitles = load_subtitles_from_srt(subtitle_file)

        if not subtitles:
            print("❌ 未找到有效字幕")
            sys.exit(1)

        # 翻译字幕（准备数据）
        translated = translate_subtitles_batch(subtitles, batch_size)

        # 设置输出路径
        if output_file is None:
            subtitle_path = Path(subtitle_file)
            output_file = subtitle_path.parent / f"{subtitle_path.stem}_bilingual.srt"

        # 创建双语字幕
        # 注意：在实际使用中，Claude 会先完成翻译，然后再调用这个函数
        print("\n⚠️  提示：此脚本需要在 Claude Code Skill 中运行")
        print("   Claude 会自动处理翻译逻辑")
        print("   当前仅输出待翻译数据")

    except Exception as e:
        print(f"\n❌ 错误: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()