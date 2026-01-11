"""File system endpoints."""

import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException

import database as db

router = APIRouter(prefix="/api", tags=["files"])


@router.get("/projects/{project_id}/modules")
async def list_project_modules(project_id: str, subpath: str = ""):
    """List subdirectories (modules) within a project for agent domain selection."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_root = Path(project["root_path"])
    if not project_root.exists():
        raise HTTPException(status_code=404, detail="Project path not found")

    if subpath:
        target_path = project_root / subpath
        try:
            target_path.resolve().relative_to(project_root.resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid path")
    else:
        target_path = project_root

    if not target_path.exists() or not target_path.is_dir():
        raise HTTPException(status_code=404, detail="Path not found")

    modules = []
    try:
        for item in sorted(target_path.iterdir(), key=lambda x: x.name.lower()):
            if item.is_dir() and not item.name.startswith('.'):
                rel_path = str(item.relative_to(project_root))
                modules.append({
                    "name": item.name,
                    "path": str(item),
                    "relative_path": rel_path,
                })
    except PermissionError:
        pass

    return {
        "modules": modules,
        "project_root": str(project_root),
        "current_path": subpath,
    }


@router.get("/files/browse")
async def browse_directories(path: str = None):
    """Browse directories for path selection."""
    if not path:
        path = str(Path.home())

    target_path = Path(path)
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    directories = []
    try:
        for item in sorted(target_path.iterdir(), key=lambda x: x.name.lower()):
            if item.is_dir():
                is_git_repo = (item / ".git").exists()
                directories.append({
                    "name": item.name,
                    "path": str(item),
                    "is_git_repo": is_git_repo,
                })
    except PermissionError:
        pass

    parent = str(target_path.parent) if target_path.parent != target_path else None

    return {
        "current_path": str(target_path),
        "parent": parent,
        "directories": directories,
    }


@router.get("/files/tree")
async def get_file_tree(path: str):
    """Get directory tree for a path."""
    target_path = Path(path)
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    git_status = {}
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(target_path),
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            for line in result.stdout.strip().split('\n'):
                if line:
                    status = line[:2].strip()
                    file_path = line[3:]
                    git_status[file_path] = status[0] if status else '?'
    except:
        pass

    def build_tree(dir_path: Path, relative_base: Path) -> dict:
        children = []
        try:
            for item in sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if item.name.startswith('.') or item.name in ['node_modules', '__pycache__', '.venv', 'venv', '.git']:
                    continue

                relative = item.relative_to(relative_base)
                node = {
                    "name": item.name,
                    "path": str(item),
                    "is_dir": item.is_dir(),
                    "git_status": git_status.get(str(relative)),
                }

                if item.is_dir():
                    node["children"] = build_tree(item, relative_base)["children"]
                else:
                    try:
                        stat = item.stat()
                        node["size"] = stat.st_size
                        node["modified"] = stat.st_mtime
                    except:
                        pass

                children.append(node)
        except PermissionError:
            pass

        return {"name": dir_path.name, "path": str(dir_path), "is_dir": True, "children": children}

    tree = build_tree(target_path, target_path)
    return tree


@router.get("/files/content")
async def get_file_content(path: str):
    """Read file content."""
    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    try:
        content = file_path.read_text(encoding='utf-8')
        stat = file_path.stat()
        return {
            "path": path,
            "content": content,
            "encoding": "utf-8",
            "size": stat.st_size,
            "modified": stat.st_mtime,
        }
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File is not a text file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/files/content")
async def write_file_content(request: dict):
    """Write file content."""
    path = request.get("path")
    content = request.get("content")

    if not path or content is None:
        raise HTTPException(status_code=400, detail="Missing path or content")

    file_path = Path(path)
    if not file_path.parent.exists():
        raise HTTPException(status_code=404, detail="Parent directory not found")

    try:
        file_path.write_text(content, encoding='utf-8')
        stat = file_path.stat()
        return {
            "path": path,
            "size": stat.st_size,
            "modified": stat.st_mtime,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/create")
async def create_file_or_folder(request: dict):
    """Create a file or folder."""
    path = request.get("path")
    is_dir = request.get("is_dir", False)
    content = request.get("content", "")

    if not path:
        raise HTTPException(status_code=400, detail="Missing path")

    target_path = Path(path)
    if target_path.exists():
        raise HTTPException(status_code=400, detail="Path already exists")

    try:
        if is_dir:
            target_path.mkdir(parents=True, exist_ok=True)
        else:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text(content, encoding='utf-8')

        return {"path": path, "is_dir": is_dir}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/files")
async def delete_file_or_folder(path: str):
    """Delete a file or folder."""
    target_path = Path(path)
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    try:
        if target_path.is_dir():
            shutil.rmtree(target_path)
        else:
            target_path.unlink()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/rename")
async def rename_file(request: dict):
    """Rename or move a file/folder."""
    old_path = request.get("old_path")
    new_path = request.get("new_path")

    if not old_path or not new_path:
        raise HTTPException(status_code=400, detail="Missing old_path or new_path")

    src = Path(old_path)
    dst = Path(new_path)

    if not src.exists():
        raise HTTPException(status_code=404, detail="Source path not found")
    if dst.exists():
        raise HTTPException(status_code=400, detail="Destination path already exists")

    try:
        src.rename(dst)
        return {"old_path": old_path, "new_path": new_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
