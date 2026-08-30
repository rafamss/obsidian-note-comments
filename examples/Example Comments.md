# Log Analysis Report

This example document is used to test the comments plugin. It contains headings, paragraphs, images, lists, tables, and code blocks — including pending and completed comments.

## Context

Reducing operational noise is essential for SOC efficiency. Type 3 logon events generate excessive volume and should be filtered at the source whenever possible.

![Architecture diagram](https://example.com/diagram.png)

## Methodology

Logs from 6 PM to 10 PM were analyzed. The query below was used to validate the observed reduction:

```spl
index="example_fortigate" sourcetype=fortigate_traffic
| timechart span=15m count
```

## Results

The results showed a 62% reduction in event volume after applying the filter. The table below summarizes the collected numbers:

| Period | Before | After |
| --- | --- | --- |
| 6 PM-7 PM | 12000 | 4600 |
| 7 PM-8 PM | 11500 | 4300 |

> Note: values are approximate and may vary depending on the analyzed environment.

## Conclusion

The source filtering strategy proved effective and should be extended to the other monitored indexes.
