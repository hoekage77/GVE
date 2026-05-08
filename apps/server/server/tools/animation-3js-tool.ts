/**
 * Animation3jsTool — Generate and serve Three.js animations in the sandbox.
 */

import { Tool } from "./Tool.js";
import { toolMetadata, methodMetadata, openapiSchema } from "./decorators.js";
import { SandboxFilesTool } from "./sandbox-files-tool.js";

@toolMetadata(
  "Three.js Animation",
  "Create, edit, and preview Three.js 3D scenes and animations. Generates self-contained HTML files with embedded Three.js code. Scenes render inline in the workspace viewer — no external links needed.",
  { weight: 30, visible: true, usage_guide: "Use create_scene to generate a new Three.js animation. The scene renders automatically in the workspace Preview tab. Use edit_scene to modify existing scenes." }
)
export class Animation3jsTool extends Tool {
  private filesTool = new SandboxFilesTool();

  @methodMetadata("Create Scene", "Create a new Three.js HTML scene file in the sandbox.")
  @openapiSchema({
    type: "function",
    function: {
      name: "create_scene",
      description: "Create a self-contained Three.js HTML file in the sandbox. The file includes a CDN link to Three.js and sets up a basic scene structure. The scene renders inline in the workspace viewer.",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID whose sandbox to target.",
          },
          file_name: {
            type: "string",
            description: "File name (e.g. 'pendulum.html').",
          },
          description: {
            type: "string",
            description: "Description of what the animation should show. This is used to generate the scene code.",
          },
          code: {
            type: "string",
            description: "The JavaScript code for the Three.js scene. Should include scene setup, camera, renderer, animation loop, and controls.",
          },
        },
        required: ["session_id", "file_name", "code"],
      },
    },
  })
  async createScene(args: {
    session_id: string;
    file_name: string;
    description?: string;
    code: string;
  }) {
    const dir = "animations";
    const filePath = `${dir}/${args.file_name}`;

    const html = this._buildHTML(args.file_name, args.code);

    // Write the HTML file
    const writeResult = await this.filesTool.writeFile({
      session_id: args.session_id,
      file_path: filePath,
      content: html,
    });

    let parsed: any;
    try {
      parsed = JSON.parse(writeResult.output);
    } catch {
      return writeResult; // Not JSON — likely an error message from the sandbox tool
    }
    if (!parsed.written) {
      return writeResult;
    }

    return this.successResponse({
      file_path: filePath,
      description: args.description ?? "Three.js scene",
      code: args.code,
      outputKind: "code",
      preview_url: null,
      server_started: false,
    });
  }

  @methodMetadata("Edit Scene", "Edit an existing Three.js scene file using string replacement.")
  @openapiSchema({
    type: "function",
    function: {
      name: "edit_scene",
      description: "Replace a specific string in an existing Three.js scene file with new content. Use str_replace semantics.",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID.",
          },
          file_path: {
            type: "string",
            description: "Path to the HTML file to edit (e.g. 'animations/pendulum.html').",
          },
          old_string: {
            type: "string",
            description: "The exact text to replace.",
          },
          new_string: {
            type: "string",
            description: "The replacement text.",
          },
        },
        required: ["session_id", "file_path", "old_string", "new_string"],
      },
    },
  })
  async editScene(args: {
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

  /** Build a self-contained HTML file with embedded Three.js scene code. */
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
    #info {
      position: absolute; top: 10px; left: 10px; color: white;
      font-family: sans-serif; font-size: 12px; opacity: 0.7;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="info">${fileName} — drag to rotate, scroll to zoom</div>
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.172.0/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.172.0/examples/jsm/"
    }
  }
  </script>
  <script type="module">
${code}
  </script>
</body>
</html>`;
  }
}
