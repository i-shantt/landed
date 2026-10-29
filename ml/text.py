"""Email text model: TF-IDF (1-2 grams, ASCII tokenizer) + logistic regression.

The tokenizer is deliberately simple so web/convex/risk/model/text.ts can reproduce it exactly:
  1. every non-ASCII byte becomes a space, then lowercase;
  2. tokens are runs of [a-z0-9_] of length >= 2;
  3. bigrams are two consecutive tokens joined by one space.
sklearn's TfidfVectorizer with these settings yields l2-normalised tf-idf with smooth idf and raw tf.
"""
from __future__ import annotations

import re

import numpy as np

TOKENIZER_ID = "ascii_word2plus_v1"
TOKEN_RE = re.compile(r"[a-z0-9_]{2,}")
NON_ASCII = re.compile(r"[^\x00-\x7f]")


def ascii_fold(s: str) -> str:
    return NON_ASCII.sub(" ", s).lower()


def tokenize(s: str) -> list[str]:
    return TOKEN_RE.findall(ascii_fold(s))


def ngrams(tokens: list[str], n_max: int = 2) -> list[str]:
    out = list(tokens)
    if n_max >= 2:
        out += [f"{a} {b}" for a, b in zip(tokens, tokens[1:])]
    return out


def make_vectorizer(max_features: int = 3000, min_df: int = 5):
    from sklearn.feature_extraction.text import TfidfVectorizer

    return TfidfVectorizer(
        preprocessor=ascii_fold,
        token_pattern=r"[a-z0-9_]{2,}",
        lowercase=False,  # ascii_fold already lowercases
        ngram_range=(1, 2),
        max_features=max_features,
        min_df=min_df,
        norm="l2",
        smooth_idf=True,
        sublinear_tf=False,
        dtype=np.float64,
    )


def score_exported(model: dict, text: str) -> float:
    """Reference implementation of the TypeScript scorer, over the exported JSON."""
    index = {t: i for i, t in enumerate(model["vocab"])}
    counts: dict[int, int] = {}
    for g in ngrams(tokenize(text), model["ngram"][1]):
        i = index.get(g)
        if i is not None:
            counts[i] = counts.get(i, 0) + 1
    if not counts:
        z = model["intercept"]
    else:
        vec = {i: c * model["idf"][i] for i, c in counts.items()}
        norm = float(np.sqrt(sum(v * v for v in vec.values())))
        z = model["intercept"] + sum(v / norm * model["coef"][i] for i, v in vec.items())
    return float(1.0 / (1.0 + np.exp(-z)))
