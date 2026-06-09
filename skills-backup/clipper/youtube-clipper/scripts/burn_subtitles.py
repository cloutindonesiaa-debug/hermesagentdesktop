#!/usr/bin/env python3
"""
烧录字幕到视频
使用 FFmpeg libass 支持烧录 ASS/SRT 字幕到视频
"""

import sys
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from utils import format_file_size, ensure_directory


def burn_subtitles(
    video_path: str,
    subtitle_path: str,
    output_path: str,
    ffmpeg_path: str = None,
    font_size: int = 24,
    margin_v: int = 30,
    font_color: str = "white",
    border_color: str = "black",
    font: str = "Arial"
) -> str:
    """
    烧录字幕到视频

    Args:
        video_path: 输入视频路径
        subtitle_path: 字幕文件路径（SRT 或 ASS）
        output_path: 输出视频路径
        ffmpeg_path: FFmpeg 路径（可选）
        font_size: 字体大小
        margin_v: 垂直边距（底部）
        font_color: 字体颜色
        border_color: 边框颜色

    Returns:
        str: 输出视频路径
    """
    video_path = Path(video_path)
    subtitle_path = Path(subtitle_path)
    output_path = Path(output_path)

    # 验证输入文件
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")
    if not subtitle_path.exists():
        raise FileNotFoundError(f"Subtitle file not found: {subtitle_path}")

    # 检测 FFmpeg
    if ffmpeg_path is None:
        ffmpeg_path = shutil.which('ffmpeg')
        if not ffmpeg_path:
            raise RuntimeError("FFmpeg not found. Please install FFmpeg.")

    print(f"\n🔥 烧录字幕到视频...")
    print(f"   视频: {video_path.name}")
    print(f"   字幕: {subtitle_path.name}")
    print(f"   输出: {output_path.name}")

    # 创建输出目录
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # 构建字幕样式过滤器
    subtitle_style = f"FontName={font}:FontSize={font_size}:MarginV={margin_v}:PrimaryColour=&H00{font_color.replace('white','FFFFFF').replace('yellow','FFFF00').replace('cyan','00FFFF').replace('green','00FF00')}:BorderColour=&H00{border_color.replace('black','000000').replace('white','FFFFFF')}:BorderStyle=1"

    # 构建 FFmpeg 命令
    # 使用 subtitles 滤镜直接烧录
    cmd = [
        ffmpeg_path,
        '-i', str(video_path),
        '-vf', f"subtitles='{subtitle_path}'",
        '-c:a', 'copy',  # 保持音频不变
        '-y',
        str(output_path)
    ]

    print(f"   执行 FFmpeg...")

    # 执行 FFmpeg
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        # 尝试使用 ass 格式
        print(f"   尝试使用 ASS 格式...")
        subtitle_ass = _convert_srt_to_ass(subtitle_path)
        if subtitle_ass:
            cmd_ass = [
                ffmpeg_path,
                '-i', str(video_path),
                '-vf', f"ass='{subtitle_ass}'",
                '-c:a', 'copy',
                '-y',
                str(output_path)
            ]
            result = subprocess.run(
                cmd_ass,
                capture_output=True,
                text=True
            )

    if result.returncode != 0:
        print(f"\n❌ FFmpeg 执行失败:")
        print(result.stderr)
        raise RuntimeError(f"FFmpeg failed with return code {result.returncode}")

    # 验证输出文件
    if not output_path.exists():
        raise RuntimeError("Output file not created")

    output_size = output_path.stat().st_size
    print(f"✅ 字幕烧录完成")
    print(f"   输出文件: {output_path}")
    print(f"   文件大小: {format_file_size(output_size)}")

    return str(output_path)


def _convert_srt_to_ass(srt_path: Path) -> Optional[Path]:
    """
    将 SRT 转换为 ASS 格式（用于更好的字幕支持）

    Args:
        srt_path: SRT 文件路径

    Returns:
        Path: ASS 文件路径，如果转换失败返回 None
    """
    ass_path = srt_path.with_suffix('.ass')

    try:
        # 使用 FFmpeg 的 filter_complex 转换
        result = subprocess.run(
            ['ffmpeg', '-y', '-i', str(srt_path), str(ass_path)],
            capture_output=True,
            text=True
        )

        if result.returncode == 0:
            return ass_path
    except Exception:
        pass

    return None


def burn_subtitles_with_temp_dir(
    video_path: str,
    subtitle_path: str,
    output_path: str,
    ffmpeg_path: str = None
) -> str:
    """
    使用临时目录烧录字幕（解决路径空格问题）

    Args:
        video_path: 输入视频路径
        subtitle_path: 字幕文件路径
        output_path: 输出视频路径
        ffmpeg_path: FFmpeg 路径

    Returns:
        str: 输出视频路径
    """
    video_path = Path(video_path)
    subtitle_path = Path(subtitle_path)
    output_path = Path(output_path)

    # 创建临时目录
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir = Path(temp_dir)

        # 复制文件到临时目录（无空格路径）
        temp_video = temp_dir / f"video_{video_path.stem}{video_path.suffix}"
        temp_subtitle = temp_dir / f"subtitle{subtitle_path.suffix}"

        shutil.copy(video_path, temp_video)
        shutil.copy(subtitle_path, temp_subtitle)

        print(f"   使用临时目录: {temp_dir}")

        # 在临时目录中执行 FFmpeg
        temp_output = temp_dir / f"output{video_path.suffix}"

        result = subprocess.run(
            [
                ffmpeg_path or 'ffmpeg',
                '-i', str(temp_video),
                '-vf', f"subtitles='{temp_subtitle}'",
                '-c:a', 'copy',
                '-y',
                str(temp_output)
            ],
            capture_output=True,
            text=True
        )

        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg failed: {result.stderr}")

        # 移动输出文件
        shutil.move(str(temp_output), str(output_path))

    return str(output_path)


def main():
    """命令行入口"""
    if len(sys.argv) < 4:
        print("Usage: python burn_subtitles.py <video> <subtitle> <output> [ffmpeg_path]")
        print("\nArguments:")
        print("  video        - 输入视频文件路径")
        print("  subtitle     - 字幕文件路径（SRT 或 ASS）")
        print("  output       - 输出视频文件路径")
        print("  ffmpeg_path  - FFmpeg 路径（可选）")
        print("\nExample:")
        print("  python burn_subtitles.py input.mp4 subtitle.srt output.mp4")
        print("  python burn_subtitles.py input.mp4 subtitle.srt output.mp4 /usr/bin/ffmpeg")
        sys.exit(1)

    video_path = sys.argv[1]
    subtitle_path = sys.argv[2]
    output_path = sys.argv[3]
    ffmpeg_path = sys.argv[4] if len(sys.argv) > 4 else None

    try:
        result_path = burn_subtitles(video_path, subtitle_path, output_path, ffmpeg_path)
        print(f"\n✨ 完成！输出文件: {result_path}")

    except Exception as e:
        print(f"\n❌ 错误: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()