import json
import matplotlib.pyplot as plt
import numpy as np

# Load the data
with open("stt_comparison_analysis.json", "r") as f:
    data = json.load(f)

timestamp_diffs = data["between_method_comparison"]["timestamp_differences"]

# Sort by word index
timestamp_diffs_sorted = sorted(timestamp_diffs, key=lambda x: x["index"])

# Extract data for plotting
positions = [item["index"] for item in timestamp_diffs_sorted]
start_diffs = [abs(item["start_diff"]) for item in timestamp_diffs_sorted]
end_diffs = [-abs(item["end_diff"]) for item in timestamp_diffs_sorted]  # Make negative for plotting below axis
words = [item["word"] for item in timestamp_diffs_sorted]

# Calculate top 10 largest discrepancies first (before plotting)
discrepancies = []
for item in timestamp_diffs_sorted:
    total_diff = abs(item["start_diff"]) + abs(item["end_diff"])
    discrepancies.append({
        "word": item["word"],
        "index": item["index"],
        "start_diff": item["start_diff"],
        "end_diff": item["end_diff"],
        "total_diff": total_diff
    })

# Sort by total difference and get top 10
top_10 = sorted(discrepancies, key=lambda x: x["total_diff"], reverse=True)[:10]

# Create the plot with extra space for table
fig, (ax, ax_table) = plt.subplots(2, 1, figsize=(8, 8),
                                     gridspec_kw={'height_ratios': [2, 1]})

# Create x positions
x = np.arange(len(positions))
width = 0.8

# Plot bars - start_diff above, end_diff below
bars1 = ax.bar(x, start_diffs, width, label='Start Diff (positive)', color='steelblue', alpha=0.8)
bars2 = ax.bar(x, end_diffs, width, label='End Diff (negative)', color='coral', alpha=0.8)

# Customize the plot
ax.axhline(y=0, color='black', linestyle='-', linewidth=0.5)
ax.set_xlabel('Word Index', fontsize=12)
ax.set_ylabel('Time Difference (seconds)', fontsize=12)
ax.set_title('Timestamp Differences: Batch vs Websocket\n(Start Diff above axis, End Diff below axis)', fontsize=14)
ax.legend()

# Set x-axis labels to show actual word_index values
# Show every Nth position to avoid overcrowding
step = max(1, len(positions) // 20)
ax.set_xticks(x[::step])
ax.set_xticklabels([positions[i] for i in range(0, len(positions), step)], rotation=45, ha='right')

# Add grid for better readability
ax.grid(axis='y', alpha=0.3, linestyle='--')

# Create table with top 10 discrepancies
ax_table.axis('tight')
ax_table.axis('off')
ax_table.set_title('Top 10 Largest Timestamp Discrepancies', fontsize=12, weight='bold', pad=20)

table_data = []
table_data.append(['Rank', 'Word', 'Index', 'Start Diff', 'End Diff', 'Total'])
for rank, item in enumerate(top_10, 1):
    table_data.append([
        str(rank),
        item['word'][:20],  # Truncate long words
        str(item['index']),
        f"{item['start_diff']:.3f}s",
        f"{item['end_diff']:.3f}s",
        f"{item['total_diff']:.3f}s"
    ])

table = ax_table.table(cellText=table_data, loc='upper center', cellLoc='center',
                       colWidths=[0.08, 0.25, 0.1, 0.15, 0.15, 0.15],
                       bbox=[0, 0.1, 1, 0.85])
table.auto_set_font_size(False)
table.set_fontsize(9)
table.scale(1, 1.5)

# Style header row
for i in range(len(table_data[0])):
    table[(0, i)].set_facecolor('#4472C4')
    table[(0, i)].set_text_props(weight='bold', color='white')

# Alternate row colors
for i in range(1, len(table_data)):
    for j in range(len(table_data[i])):
        if i % 2 == 0:
            table[(i, j)].set_facecolor('#E7E6E6')

plt.tight_layout()
print(f"Total timestamp differences plotted: {len(positions)}")

plt.show()
