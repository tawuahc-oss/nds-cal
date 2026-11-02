from pathlib import Path
import sys
root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / '.tooling' / 'python'))
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
font = TTFont(root / '.local-backups' / 'NotoSansTC-variable.ttf')
font = instantiateVariableFont(font, {'wght': 400}, inplace=True)
font.save(root / 'assets' / 'fonts' / 'NotoSansTC.ttf')
print('Static Regular Traditional Chinese font prepared.')
