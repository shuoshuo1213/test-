#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拼豆工坊 · rembg 本地去背景服务

安装依赖（建议用虚拟环境）：
    pip install rembg fastapi uvicorn python-multipart
    # 首次运行会自动下载模型（u2net 约 176 MB），之后可离线使用

启动：
    python tools/rembg_server.py                 # http://127.0.0.1:7000
    python tools/rembg_server.py --port 8000     # 换端口
    python tools/rembg_server.py --model isnet-general-use

接口：
    GET  /health   → {"ok": true}
    POST /remove   → 表单字段 file=图片，返回带透明通道的 PNG

在网页里：原图卡片勾选「去除背景」→ 抠图方式选「rembg 服务」，地址默认
http://127.0.0.1:7000，改端口时在网页里同步改即可。
"""

import argparse
import io
import sys

try:
    from fastapi import FastAPI, File, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, Response
    import uvicorn
except ImportError:  # pragma: no cover
    print("缺少依赖，请先执行：pip install fastapi uvicorn python-multipart")
    raise SystemExit(1)

MODEL_NAME = "u2net"
_session = None


def get_session():
    """懒加载模型：第一次请求时才下载/载入，避免启动就卡住"""
    global _session
    if _session is None:
        from rembg import new_session
        print("· 正在载入模型 %s（首次会下载，请稍候）…" % MODEL_NAME)
        _session = new_session(MODEL_NAME)
        print("· 模型就绪")
    return _session


app = FastAPI(title="拼豆工坊 · rembg 服务", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.middleware("http")
async def allow_private_network(request, call_next):
    """Chrome 的 Private Network Access：允许 file:// / https 页面访问本机服务"""
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.get("/health")
def health():
    return {"ok": True, "service": "rembg", "model": MODEL_NAME}


@app.post("/remove")
async def remove_bg(file: UploadFile = File(...)):
    try:
        from rembg import remove
    except ImportError:
        return JSONResponse({"error": "未安装 rembg：pip install rembg"}, status_code=503)

    raw = await file.read()
    if not raw:
        return JSONResponse({"error": "空文件"}, status_code=400)

    try:
        out = remove(raw, session=get_session())
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": "抠图失败：%s" % exc}, status_code=500)

    if not isinstance(out, (bytes, bytearray)):
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        out = buf.getvalue()

    return Response(content=bytes(out), media_type="image/png")


def main():
    parser = argparse.ArgumentParser(description="拼豆工坊 rembg 服务")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认 127.0.0.1")
    parser.add_argument("--port", type=int, default=7000, help="监听端口，默认 7000")
    parser.add_argument("--model", default="u2net", help="模型：u2net / isnet-general-use / u2netp / silueta")
    args = parser.parse_args()

    global MODEL_NAME
    MODEL_NAME = args.model

    print("拼豆工坊 · rembg 服务")
    print("  地址：http://%s:%d" % (args.host, args.port))
    print("  模型：%s" % args.model)
    print("  网页里：原图 → 勾选「去除背景」→ 抠图方式选「rembg 服务」")
    print("  Ctrl+C 退出")

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已退出")
        sys.exit(0)
