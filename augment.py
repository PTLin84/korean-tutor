import json
import os
from pathlib import Path
import anthropic

# Load .env from project root if present
_env = Path(__file__).parent / ".env"
if _env.exists():
    for line in _env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

client = anthropic.Anthropic()

SYSTEM_PROMPT = (
    "你是一位專業的韓語教學助手。用戶會提供韓語單字、繁體中文意思及課堂例句，"
    "請生成詳細的學習輔助資料。所有回應必須使用繁體中文。"
    "只回傳 JSON，不含任何 markdown 標記或額外文字。"
)


def augment_word(korean: str, meaning: str, sentence: str) -> dict:
    """Call Claude Sonnet to augment a Korean word with study materials in Traditional Chinese."""
    user_prompt = f"""韓語單字：{korean}
繁體中文意思：{meaning}
課堂例句：{sentence if sentence else "（無）"}

請回傳以下 JSON（只回傳 JSON，無其他文字）。每個欄位請保持簡短精要，整體回應必須在 800 tokens 以內：
{{
  "sentences": [
    {{"korean": "初級例句（15字以內）", "chinese": "繁體中文翻譯", "level": "beginner"}},
    {{"korean": "中級例句（15字以內）", "chinese": "繁體中文翻譯", "level": "intermediate"}},
    {{"korean": "高級例句（15字以內）", "chinese": "繁體中文翻譯", "level": "advanced"}}
  ],
  "usage_notes": "使用說明，2～3句（繁體中文）",
  "related_words": [
    {{"korean": "相關詞1", "chinese": "繁體中文意思1"}},
    {{"korean": "相關詞2", "chinese": "繁體中文意思2"}}
  ],
  "common_mistakes": "常見錯誤，1～2句（繁體中文）"
}}"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    text = response.content[0].text.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    return json.loads(text)


def validate_word(korean: str, meaning: str, sentence: str) -> dict:
    """
    Ask Claude to verify a Korean word entry and suggest corrections if needed.

    Returns:
      { "ok": true }
        — everything looks correct, proceed as-is

      { "ok": false,
        "message": "說明問題的一句話（繁體中文）",
        "suggested_korean": "...",    # corrected Korean, or same if no change
        "suggested_meaning": "...",   # corrected meaning, or same if no change
        "suggested_sentence": "..." } # corrected sentence, or same / "" if no change
    """
    user_prompt = f"""請驗證以下韓語單字輸入是否正確：

韓語單字：{korean}
繁體中文意思：{meaning}
課堂例句：{sentence if sentence else "（無）"}

請檢查：
1. 韓語拼寫是否正確（是否有拼字錯誤、少音節等）
2. 繁體中文意思是否與韓語單字相符
3. 若有例句，例句中是否正確使用了該單字

只回傳 JSON（無 markdown）：

若完全正確：
{{"ok": true}}

若有問題：
{{
  "ok": false,
  "message": "一句話說明問題（繁體中文）",
  "suggested_korean": "建議的韓語（若無需修改則與原本相同）",
  "suggested_meaning": "建議的繁體中文意思（若無需修改則與原本相同）",
  "suggested_sentence": "建議的例句（若無例句或無需修改則為空字串）"
}}"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",  # fast + cheap for validation
        max_tokens=256,
        system="你是一位專業的韓語教學助手。只回傳 JSON，不含任何 markdown 標記或額外文字。",
        messages=[{"role": "user", "content": user_prompt}],
    )

    text = response.content[0].text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    result = json.loads(text)

    # Normalise: if ok is true, drop any stray suggestion fields
    if result.get("ok"):
        return {"ok": True}

    # Fill in original values for fields Claude didn't suggest changing,
    # including when Claude explicitly returned null for a field.
    result["suggested_korean"]   = result.get("suggested_korean")   or korean
    result["suggested_meaning"]  = result.get("suggested_meaning")  or meaning
    result["suggested_sentence"] = result.get("suggested_sentence") or sentence
    return result
