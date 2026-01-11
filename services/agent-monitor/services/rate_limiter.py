"""Rate limit monitor for Claude API usage."""

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

# Rate limit configuration
STATS_CACHE_PATH = Path.home() / ".claude" / "stats-cache.json"

# Default limits (conservative estimates)
DEFAULT_DAILY_MESSAGE_LIMIT = 10000
DEFAULT_DAILY_TOKEN_LIMIT = 2_000_000


@dataclass
class UsageStats:
    """Current usage statistics."""
    date: str
    messages_today: int = 0
    tokens_today: int = 0
    sessions_today: int = 0
    tool_calls_today: int = 0

    @property
    def is_approaching_limit(self) -> bool:
        """Check if we're approaching daily limits (70%)."""
        return (
            self.messages_today > DEFAULT_DAILY_MESSAGE_LIMIT * 0.7 or
            self.tokens_today > DEFAULT_DAILY_TOKEN_LIMIT * 0.7
        )

    @property
    def is_at_limit(self) -> bool:
        """Check if we've hit daily limits (90%)."""
        return (
            self.messages_today > DEFAULT_DAILY_MESSAGE_LIMIT * 0.9 or
            self.tokens_today > DEFAULT_DAILY_TOKEN_LIMIT * 0.9
        )


class RateLimitMonitor:
    """Monitors rate limits from Claude's stats-cache.json."""

    def __init__(self, stats_path: Path = STATS_CACHE_PATH):
        self.stats_path = stats_path
        self._cache: Optional[dict] = None
        self._cache_time: Optional[datetime] = None
        self._cache_ttl = timedelta(seconds=30)

    def _load_stats(self) -> dict:
        """Load stats from cache file."""
        now = datetime.now()

        # Return cached if fresh
        if self._cache and self._cache_time:
            if now - self._cache_time < self._cache_ttl:
                return self._cache

        # Load from file
        if self.stats_path.exists():
            try:
                self._cache = json.loads(self.stats_path.read_text())
                self._cache_time = now
                return self._cache
            except (json.JSONDecodeError, IOError) as e:
                print(f"[RATE_LIMITER] Failed to load stats: {e}")

        return {}

    def get_today_usage(self) -> UsageStats:
        """Get today's usage statistics."""
        stats = self._load_stats()
        today = datetime.now().strftime("%Y-%m-%d")

        usage = UsageStats(date=today)

        # Find today's activity
        daily_activity = stats.get("dailyActivity", [])
        for day in daily_activity:
            if day.get("date") == today:
                usage.messages_today = day.get("messageCount", 0)
                usage.sessions_today = day.get("sessionCount", 0)
                usage.tool_calls_today = day.get("toolCallCount", 0)
                break

        # Find today's tokens
        daily_tokens = stats.get("dailyModelTokens", [])
        for day in daily_tokens:
            if day.get("date") == today:
                tokens_by_model = day.get("tokensByModel", {})
                usage.tokens_today = sum(tokens_by_model.values())
                break

        return usage

    def get_usage_percentage(self) -> dict:
        """Get usage as percentage of limits."""
        usage = self.get_today_usage()
        return {
            "messages": min(100, (usage.messages_today / DEFAULT_DAILY_MESSAGE_LIMIT) * 100),
            "tokens": min(100, (usage.tokens_today / DEFAULT_DAILY_TOKEN_LIMIT) * 100),
            "date": usage.date,
            "raw": {
                "messages_today": usage.messages_today,
                "tokens_today": usage.tokens_today,
                "message_limit": DEFAULT_DAILY_MESSAGE_LIMIT,
                "token_limit": DEFAULT_DAILY_TOKEN_LIMIT,
            }
        }

    def should_pause(self, warning_threshold: float = 0.9) -> tuple[bool, str]:
        """Check if we should pause due to rate limits."""
        usage = self.get_today_usage()

        if usage.messages_today >= DEFAULT_DAILY_MESSAGE_LIMIT * warning_threshold:
            return True, f"Daily message limit reached ({usage.messages_today}/{DEFAULT_DAILY_MESSAGE_LIMIT})"

        if usage.tokens_today >= DEFAULT_DAILY_TOKEN_LIMIT * warning_threshold:
            return True, f"Daily token limit reached ({usage.tokens_today}/{DEFAULT_DAILY_TOKEN_LIMIT})"

        return False, ""

    def should_throttle(self, warning_threshold: float = 0.7) -> tuple[bool, str]:
        """Check if we should throttle due to approaching limits."""
        usage = self.get_today_usage()

        if usage.messages_today >= DEFAULT_DAILY_MESSAGE_LIMIT * warning_threshold:
            return True, f"Approaching message limit ({usage.messages_today}/{DEFAULT_DAILY_MESSAGE_LIMIT})"

        if usage.tokens_today >= DEFAULT_DAILY_TOKEN_LIMIT * warning_threshold:
            return True, f"Approaching token limit ({usage.tokens_today}/{DEFAULT_DAILY_TOKEN_LIMIT})"

        return False, ""
