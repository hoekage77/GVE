/**
 * AnimationP5jsTool — Generate and serve p5.js sketches in the sandbox.
 */

import { Tool } from "./Tool.js";
import { toolMetadata, methodMetadata, openapiSchema } from "./decorators.js";
import { SandboxFilesTool } from "./sandbox-files-tool.js";

@toolMetadata(
  "p5.js Animation",
  "Create, edit, and preview p5.js 2D/3D sketches and generative art. Generates self-contained HTML files. Scenes render inline in the workspace viewer — no external links needed.",
  { weight: 31, visible: true, usage_guide: "Use create_sketch to generate a new p5.js animation. The scene renders automatically in the workspace Preview tab. Use edit_sketch to modify existing sketches." }
)
export class AnimationP5jsTool extends Tool {
  private filesTool = new SandboxFilesTool();

  @methodMetadata("Create Sketch", "Create a new p5.js HTML sketch file.")
  @openapiSchema({
    type: "function",
    function: {
      name: "create_sketch",
      description: "Create a self-contained p5.js HTML file. The file includes p5.js from CDN and your sketch code. The scene renders inline in the workspace viewer.",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID whose sandbox to target.",
          },
          file_name: {
            type: "string",
            description: "File name (e.g. 'wave.html').",
          },
          description: {
            type: "string",
            description: "What the sketch should visualize.",
          },
          code: {
            type: "string",
            description: "The p5.js sketch code. Should include setup() and draw() functions. Use p5.js global mode (no import needed).",
          },
        },
        required: ["session_id", "file_name", "code"],
      },
    },
  })
  async createSketch(args: {
    session_id: string;
    file_name: string;
    description?: string;
    code: string;
  }) {
    const dir = "sketches";
    const filePath = `${dir}/${args.file_name}`;

    const html = this._buildHTML(args.file_name, args.code);

    const writeResult = await this.filesTool.writeFile({
      session_id: args.session_id,
      file_path: filePath,
      content: html,
    });

    const parsed = JSON.parse(writeResult.output);
    if (!parsed.written) {
      return writeResult;
    }

    return this.successResponse({
      file_path: filePath,
      description: args.description ?? "p5.js sketch",
      code: args.code,
      outputKind: "code",
      preview_url: null,
      server_started: false,
    });
  }

  @methodMetadata("Edit Sketch", "Edit an existing p5.js sketch using string replacement.")
  @openapiSchema({
    type: "function",
    function: {
      name: "edit_sketch",
      description: "Replace text in an existing p5.js sketch file.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "The session ID." },
          file_path: { type: "string", description: "Path to the HTML file." },
          old_string: { type: "string", description: "Exact text to replace." },
          new_string: { type: "string", description: "Replacement text." },
        },
        required: ["session_id", "file_path", "old_string", "new_string"],
      },
    },
  })
  async editSketch(args: {
    session_id: string;
    file_path: string;
    old_string: string;
    new_string: string;
  }) {
    return this.filesTool.strReplace({
      session_id: args.session_id,
      file_path: args.file_path,
      old_string: args.old_string,
      new_string: args.new_string,
    });
  }

  private _buildHTML(fileName: string, code: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #0f172a; }
    canvas { display: block; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
</head>
<body>
  <script>
${code}
  </script>
</body>
</html>`;
  }
}
