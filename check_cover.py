import urllib.request, re

# Check the homepage for how the react-hooks post cover is rendered
print("=== Homepage PostCard cover rendering ===")
try:
    req = urllib.request.urlopen("http://localhost:3001/")
    html = req.read().decode()

    # Find all image src values
    img_srcs = re.findall(r'src="(.*?)"', html)
    for src in img_srcs:
        if "react" in src.lower() or "hooks" in src.lower() or "unsplash" in src or "data:image" in src:
            print(f"  Image: {src[:150]}")

    # Also check for gradient backgrounds (fallback)
    gradients = re.findall(r'bg-gradient-to-br\s+(from-\S+\s+to-\S+)', html)
    if gradients:
        print(f"  Gradient fallbacks found: {len(gradients)}")
except Exception as e:
    print(f"Error: {e}")

# Check the post detail page
print("\n=== Post detail page cover rendering ===")
try:
    req = urllib.request.urlopen("http://localhost:3001/posts/react-hooks-best-practices")
    html = req.read().decode()

    # Find image src in the cover area
    img_srcs = re.findall(r'<img[^>]*src="([^"]*)"', html)
    for src in img_srcs:
        print(f"  Image: {src[:150]}")

    # Check the cover div class
    cover_divs = re.findall(r'class="relative[^"]*rounded[^"]*"', html)
    for div in cover_divs[:3]:
        print(f"  Cover div class: {div[:100]}")
except Exception as e:
    print(f"Error: {e}")

# Check the API response directly
print("\n=== API response for react-hooks post ===")
import json
try:
    req = urllib.request.urlopen("http://localhost:18888/api/posts/react-hooks-best-practices")
    data = json.loads(req.read().decode())
    print(f"  Title: {data.get('title')}")
    print(f"  Cover image: {data.get('cover_image', 'NOT SET')}")
    print(f"  Category: {data.get('category')}")
except Exception as e:
    print(f"Error: {e}")
