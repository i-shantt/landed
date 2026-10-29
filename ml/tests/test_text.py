import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from text import ascii_fold, make_vectorizer, ngrams, score_exported, tokenize  # noqa: E402


def test_tokenizer_edge_cases():
    assert tokenize("Hello, World! a I ok 42 x_y") == ["hello", "world", "ok", "42", "x_y"]
    assert tokenize("Ünïcödé café naïve") == ["caf", "na", "ve"]  # non-ASCII becomes a separator
    assert tokenize("URGENT:wire\tfunds\nnow") == ["urgent", "wire", "funds", "now"]
    assert tokenize("") == [] and tokenize("a b c") == []
    assert ngrams(["a1", "b2", "c3"]) == ["a1", "b2", "c3", "a1 b2", "b2 c3"]
    assert ascii_fold("AéB") == "a b"


def test_vectorizer_matches_hand_tokenizer_and_exported_scorer():
    docs = ["please wire the funds today", "invoice attached, thanks", "wire transfer urgent please wire", "the quarterly report is attached", "please please please"]
    vec = make_vectorizer(max_features=50, min_df=1)
    X = vec.fit_transform(docs)
    vocab = vec.get_feature_names_out().tolist()
    # sklearn tokenizes exactly like our tokenizer + bigrams
    analyzer = vec.build_analyzer()
    for d in docs:
        assert sorted(analyzer(d)) == sorted(ngrams(tokenize(d)))
    coef = np.linspace(-1, 1, len(vocab))
    model = {"vocab": vocab, "idf": vec.idf_.tolist(), "coef": coef.tolist(), "intercept": -0.3, "ngram": [1, 2]}
    for i, d in enumerate(docs + ["completely unseen words"]):
        x = vec.transform([d]).toarray()[0]
        expected = 1 / (1 + np.exp(-(x @ coef - 0.3)))
        assert abs(score_exported(model, d) - expected) < 1e-12, (i, d)
