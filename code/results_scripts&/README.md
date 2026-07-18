
# Execution Environment (Kaggle)

These scripts are pre-configured to run out-of-the-box in a **Kaggle Notebook** environment utilizing an **NVIDIA Tesla T4 GPU**. 

## Prerequisites & Data Ingestion
To successfully run these scripts, you must attach the required source dataset directly to your Kaggle environment as an input directory.

1. In your Kaggle Notebook sidebar, click on **"Add Input"** (or **"Add Data"**).
2. Search for and add the data repository provided by user `claudiacornacchia`.
3. Ensure the internal directory layout maps precisely to the following structure:

```text
/kaggle/input/datasets/claudiacornacchia/
└── embedding/
    ├── base_map.csv
    └── embeddings_1024d.pt
