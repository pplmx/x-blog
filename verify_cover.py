import urllib.request, re

# Check PostCard cover on homepage
print("=== Homepage PostCard ===")
try:
    req = urllib.request.urlopen("http://localhost:3001/")
    html = req.read().decode()

    # Find cover image divs
    cover_divs = re.findall(r'class="relative\s+(.*?overflow-hidden)"', html)
    for div in cover_divs[:5]:
        print(f"  Cover div: relative {div[:80]}")

    # Find aspect-[2/1] divs
    aspect_count = html.count("aspect-[2/1]")
    print(f"  Total aspect-[2/1] divs: {aspect_count}")

    # Find h-48 divs (should be 0 after fix)
    h48_count = html.count("h-48")
    print(f"  Total h-48 divs: {h48_count}")

    if h48_count == 0:
        print("  PASS: No h-48 divs (using aspect-[2/1] consistently)")
    else:
        print("  WARN: h-48 divs still present")
except Exception as e:
    print(f"Error: {e}")

# Check post detail page
print("\n=== Post detail page ===")
try:
    req = urllib.request.urlopen("http://localhost:3001/posts/react-hooks-best-practices")
    html = req.read().decode()

    # Find cover image divs
    cover_divs = re.findall(r'class="relative\s+(.*?overflow-hidden)"', html)
    for div in cover_divs[:5]:
        print(f"  Cover div: relative {div[:80]}")

    # Check for aspect-[2/1]
    if "aspect-[2/1]" in html:
        print("  PASS: Post detail uses aspect-[2/1]")
except Exception as e:
    print(f"Error: {e}")

# Check that both use same aspect ratio
print("\n=== Consistency check ===")
try:
    req = urllib.request.urlopen("http://localhost:3001/")
    homepage_html = req.read().decode()
    req = urllib.request.urlopen("http://localhost:3001/posts/react-hooks-best-practices")
    detail_html = req.read().decode()

    homepage_aspect = "aspect-[2/1]" in homepage_html
    detail_aspect = "aspect-[2/1]" in detail_html

    if homepage_aspect and detail_aspect:
        print("PASS: Both PostCard and post detail use aspect-[2/1]")
    elif not homepage_aspect and not detail_aspect:
        print("WARN: Neither uses aspect-[2/1]")
    else:
        print("FAIL: Inconsistent aspect ratios")
        print(f"  Homepage: {homepage_aspect}")
        print(f"  Detail: {detail_aspect}")
except Exception as e:
    print(f"Error: {e}")
