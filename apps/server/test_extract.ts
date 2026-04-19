function _extractCode(text: string): string {
    const match = text.match(/```(?:javascript|typescript|js|ts|python|py)?\n([\s\S]*?)\n```/);
    if (match) return match[1]!.trim();

    const lines = text.split("\n");
    const codeLines: string[] = [];
    let inCode = false;

    for (const line of lines) {
      if (line.includes("```")) {
        inCode = !inCode;
      } else if (inCode) {
        codeLines.push(line);
      }
    }

    return codeLines.join("\n").trim() || text;
}

const input = "Here is the code:\n```python\nprint('hello')\n```\nExplanation: Hi";
console.log(_extractCode(input));
