"""Check the reading editions against their deposited files. Run offline."""

import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path


SITE = Path(__file__).resolve().parents[1]


class PageMetadata(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.meta = {}
        self.feed(path.read_text(encoding="utf-8"))
        self.close()

    def handle_starttag(self, tag, attrs):
        if tag == "meta":
            attributes = dict(attrs)
            if "name" in attributes:
                self.meta[attributes["name"]] = attributes.get("content")


def main():
    papers = json.loads((SITE / "papers/manifest.json").read_text("utf-8"))["papers"]
    if not papers:
        raise ValueError("The paper manifest is empty")
    files_checked = 0
    for paper in papers:
        landing = SITE / paper["url"].lstrip("/")
        for entry in paper["files"]:
            path = SITE / entry["url"].lstrip("/")
            data = path.read_bytes()
            if (len(data) != entry["bytes"]
                    or hashlib.md5(data).hexdigest() != entry["md5"]
                    or hashlib.sha256(data).hexdigest() != entry["sha256"]):
                raise ValueError(f"{path.name} differs from the manifest for {paper['edition_doi']}")
            files_checked += 1

        source_hash = hashlib.sha256((landing / "revision.tex").read_bytes()).hexdigest()
        article = PageMetadata(landing / "article.html").meta
        guide = PageMetadata(landing / "guide/index.html").meta
        if any(page.get("paper-source-sha256") != source_hash for page in (article, guide)):
            raise ValueError(f"{landing.name}: article or guide refers to a different manuscript")

        cover = PageMetadata(landing / "index.html").meta
        for citation in (cover, article):
            if (citation.get("citation_title") != paper["title"]
                    or citation.get("citation_doi") != paper["edition_doi"]
                    or citation.get("citation_publication_date", "").replace("/", "-")
                    != paper["publication_date"]):
                raise ValueError(f"{landing.name}: citation differs from the manifest")
    print(f"Verified {files_checked} deposited files and {len(papers)} reading editions.")


if __name__ == "__main__":
    main()
