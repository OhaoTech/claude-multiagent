"""Skill management service."""

import re
import shutil
from pathlib import Path

from config import SKILLS_DIR


def parse_skill_metadata(skill_path: Path) -> dict:
    """Parse skill metadata from SKILL.md frontmatter."""
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return {"name": skill_path.name, "description": ""}

    content = skill_md.read_text()
    metadata = {"name": skill_path.name, "description": ""}

    # Parse YAML frontmatter
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            frontmatter = parts[1]
            name_match = re.search(r'^name:\s*(.+)$', frontmatter, re.MULTILINE)
            desc_match = re.search(r'^description:\s*(.+)$', frontmatter, re.MULTILINE)
            if name_match:
                metadata["name"] = name_match.group(1).strip()
            if desc_match:
                metadata["description"] = desc_match.group(1).strip()

    return metadata


def get_available_skills() -> list[dict]:
    """Get list of available skills from the bundled skills directory."""
    skills = []
    if not SKILLS_DIR.exists():
        return skills

    for skill_path in sorted(SKILLS_DIR.iterdir()):
        if skill_path.is_dir() and not skill_path.name.startswith('.'):
            metadata = parse_skill_metadata(skill_path)
            skills.append({
                "id": skill_path.name,
                "name": metadata["name"],
                "description": metadata["description"],
                "path": str(skill_path),
            })

    return skills


def get_installed_skills(project_root: Path) -> list[dict]:
    """Get list of installed skills for a project."""
    skills_dir = project_root / ".claude" / "skills"
    if not skills_dir.exists():
        return []

    skills = []
    for skill_path in sorted(skills_dir.iterdir()):
        if skill_path.is_dir() and not skill_path.name.startswith('.'):
            metadata = parse_skill_metadata(skill_path)
            skills.append({
                "id": skill_path.name,
                "name": metadata["name"],
                "description": metadata["description"],
                "path": str(skill_path),
            })

    return skills


def install_skill(project_root: Path, skill_id: str) -> bool:
    """Install a skill to a project by copying from bundled skills."""
    source = SKILLS_DIR / skill_id
    if not source.exists():
        return False

    target = project_root / ".claude" / "skills" / skill_id
    target.parent.mkdir(parents=True, exist_ok=True)

    if target.exists():
        shutil.rmtree(target)

    shutil.copytree(source, target)
    return True


def uninstall_skill(project_root: Path, skill_id: str) -> bool:
    """Uninstall a skill from a project."""
    target = project_root / ".claude" / "skills" / skill_id
    if not target.exists():
        return False

    shutil.rmtree(target)
    return True
