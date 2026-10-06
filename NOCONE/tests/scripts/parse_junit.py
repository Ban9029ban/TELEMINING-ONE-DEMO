import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
tree = ET.parse(path)
root = tree.getroot()

tests = failures = errors = skipped = 0
nodes = [root]
for node in nodes + list(root.iter("testsuite")):
    tests += int(node.attrib.get("tests", 0) or 0)
    failures += int(node.attrib.get("failures", 0) or 0)
    errors += int(node.attrib.get("errors", 0) or 0)
    skipped += int(node.attrib.get("skipped", 0) or 0)

failed = failures + errors
passed = max(tests - failed - skipped, 0)
print(f"{tests} {passed} {failed}")
