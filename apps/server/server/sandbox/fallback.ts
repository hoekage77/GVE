/**
 * Sandbox fallback scene edits
 * Applied when LLM modification fails
 */

export async function applyFallbackSceneEdit(currentCode: string, instruction: string): Promise<any> {
  const normalizedInstruction = instruction.trim().toLowerCase();
  let nextCode = currentCode;

  // Simple regex-based fallback edits
  if (/color|colour/.test(normalizedInstruction)) {
    const colorMatch = normalizedInstruction.match(/(blue|red|green|yellow|purple|orange|white|black|pink|cyan)/);
    if (colorMatch) {
      nextCode = nextCode.replace(
        /(color|colour)\s*:\s*['"]#[0-9a-fA-F]{6}['"]/gi,
        `color: '${colorMatch[1]}'`
      );
    }
  }

  if (/rotate|spin|rotation/.test(normalizedInstruction)) {
    if (!/rotation\.y/.test(nextCode)) {
      nextCode = nextCode.replace(
        /(function\s+animate\s*\(\)\s*\{)/,
        `$1\n    mesh.rotation.y += 0.01;`
      );
    }
  }

  if (/scale|size|bigger|smaller/.test(normalizedInstruction)) {
    if (/\.scale\(/.test(nextCode)) {
      nextCode = nextCode.replace(
        /\.scale\((\d+\.?\d*)\)/g,
        (match, num) => {
          const scale = /bigger|larger/.test(normalizedInstruction) 
            ? (parseFloat(num) * 1.5).toFixed(2)
            : (parseFloat(num) * 0.75).toFixed(2);
          return `.scale(${scale})`;
        }
      );
    }
  }

  const changed = nextCode !== currentCode;

  return {
    generatedCode: changed ? nextCode : currentCode,
    changeSummary: changed
      ? `Applied fallback edit: ${instruction}`
      : "Fallback could not apply edit; returned original code."
  };
}
