from datetime import date, timedelta


def sm2_update(ease_factor: float, interval: int, review_count: int, result: str):
    """
    SM-2 spaced repetition algorithm.
    result: 'pass' (q=5), 'hard' (q=2), 'fail' (q=0)
    Returns (new_ease_factor, new_interval, new_due_date_str).
    """
    quality = {'pass': 5, 'hard': 2, 'fail': 0}
    q = quality.get(result, 0)

    if q >= 3:
        if review_count == 0:
            new_interval = 1
        elif review_count == 1:
            new_interval = 6
        else:
            new_interval = max(1, round(interval * ease_factor))

        new_ef = ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        new_ef = max(1.3, new_ef)
    else:
        new_interval = 1
        new_ef = max(1.3, ease_factor - 0.2)

    new_due = (date.today() + timedelta(days=new_interval)).isoformat()
    return new_ef, new_interval, new_due
