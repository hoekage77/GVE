import os

files = os.listdir()
for f in files:
    if f.endswith('.js'):
        ts_equivalent = f[:-3] + '.ts'
        if ts_equivalent in files:
            print(f"Removing duplicate {f}")
            os.remove(f)
